"""Read source paths from a JSON array on stdin and emit diagnostic sites as JSONL."""

import ast
from contextlib import contextmanager
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import sys


BAD_STATES = frozenset({
    "blocked", "disconnected", "error", "failed", "forbidden", "incompatible", "invalid",
    "missing", "needs_human_auth", "not_run", "occupied", "rejected", "same_root_controller", "stale", "timed_out",
    "unavailable", "unconfirmed", "unknown", "unsupported",
})
STATE_FIELDS = frozenset({
    "status", "state", "validation_status", "artifact_status", "queue_status", "outcome",
})
EXIT_FIELDS = frozenset({"exit_code", "returncode"})
BOOLEAN_FIELDS = {"ok": False, "success": False, "valid": False, "isError": True, "is_error": True}
WARNING_FIELDS = frozenset({"warning", "warnings", "advisories"})
DIAGNOSTIC_FIELDS = frozenset({
    "error", "errors", "launch_error", "failure", "failures", "reason", "reasons", "issue", "issues",
}) | WARNING_FIELDS
CONTEXT_FIELDS = frozenset({"code", "message", "detail", "operation_state", "phase", "next_step", "scope"})
EXIT_CALLS = frozenset({"sys.exit", "os._exit", "exit", "quit"})
ISSUE_COLLECTORS = DIAGNOSTIC_FIELDS | {"blockers", "omitted", "omitted_outputs", "unresolved"}
SHELL_EXIT = r"exit\s+(?:[1-9]\d*|['\"]?\$[^\s;]+)"
SHELL_FAILURE = re.compile(rf"\b(?:{SHELL_EXIT})|(?:>&\s*2|/dev/stderr)")
STRING_SOURCE = re.compile(r"([rRuUfF]*)(\"\"\"|'''|\"|')(.*)\2", re.S)
PYTHON_START = re.compile(r"\s*(?:import\s+\w|from\s+[.\w]+\s+import\s|#![^\n]*python)")
CMD_START = re.compile(r"^[ \t]*(?:@echo off|exit /b\b|if errorlevel\s+\d+\s+exit\b)", re.M | re.I)
POWERSHELL_START = re.compile(r"^[ \t]*(?:\$env:|Set-Location\b|exit\s+\$LASTEXITCODE\b)", re.M | re.I)


def literal(node):
    return node.value if isinstance(node, ast.Constant) else None


def dotted(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = dotted(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""


def fixed_text(node):
    """Recognize source-authored text inside a partially dynamic expression."""
    if isinstance(node, ast.Constant):
        return isinstance(node.value, (str, bytes)) and bool(node.value.strip())
    if isinstance(node, ast.IfExp):
        return fixed_text(node.body) or fixed_text(node.orelse)
    if isinstance(node, ast.Subscript):
        return fixed_text(node.value)
    if isinstance(node, ast.Dict):
        return any(fixed_text(value) for value in node.values)
    if isinstance(node, ast.Call):
        base = node.func.value if isinstance(node.func, ast.Attribute) else None
        args = node.args
        if dotted(node.func) == "getattr":
            args = args[2:]
        elif isinstance(node.func, ast.Attribute) and node.func.attr == "get":
            args = args[1:]
        return (base is not None and fixed_text(base)) or any(fixed_text(arg) for arg in args)
    if isinstance(node, (ast.JoinedStr, ast.BinOp, ast.BoolOp, ast.List, ast.Tuple, ast.Set)):
        return any(fixed_text(child) for child in ast.iter_child_nodes(node))
    return False


def nonempty(node):
    if isinstance(node, ast.Constant):
        return bool(node.value)
    if isinstance(node, (ast.List, ast.Set, ast.Tuple)):
        return bool(node.elts)
    if isinstance(node, ast.Dict):
        return bool(node.keys)
    return True


def site(path, line, column, kind, signal, guard, owner, channel):
    return dict(path=path, line=line, column=column, kind=kind, signal=signal.strip(),
                guard=" | ".join(guard), owner=owner or "<module>", channel=channel,
                authorship="forwarded" if kind == "forward" else "authored")


class PythonSites(ast.NodeVisitor):
    def __init__(self, path, source, *, owner=(), guards=(), tag="", line_offset=0,
                 first_column_offset=0):
        self.path = path
        self.lines = [line.encode("utf-8") for line in source.split("\n")]
        self.owner = owner
        self.guards = guards
        self.tag = tag
        self.line_offset = line_offset
        self.first_column_offset = first_column_offset
        self.sites = []
        self.coverage = []
        self.payload_channels = {}
        self.shell_literals = set()

    def scan(self, tree):
        self.fail_helpers = {}
        self.cli_main = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body = node.body[1:] if ast.get_docstring(node) is not None else node.body
                if len(body) == 1 and isinstance(body[0], ast.Raise):
                    self.fail_helpers[node.name] = body[0]
            if isinstance(node, ast.Call) and dotted(node.func) in EXIT_CALLS | {"SystemExit"}:
                if node.args and isinstance(node.args[0], ast.Call):
                    self.cli_main.add(dotted(node.args[0].func))
        self.visit(tree)

    def source(self, node):
        first, last = node.lineno - 1, node.end_lineno - 1
        if first == last:
            return self.lines[first][node.col_offset:node.end_col_offset].decode("utf-8")
        parts = [self.lines[first][node.col_offset:], *self.lines[first + 1:last],
                 self.lines[last][:node.end_col_offset]]
        return b"\n".join(parts).decode("utf-8")

    def location(self, node):
        line = self.lines[node.lineno - 1]
        column = len(line[:node.col_offset].decode("utf-8"))
        if node.lineno == 1:
            column += self.first_column_offset
        return node.lineno + self.line_offset, column + 1

    def add(self, node, kind, signal=None, *, channel="python", extra_guards=()):
        line, column = self.location(node)
        if self.tag:
            channel = f"{self.tag}/{channel}"
        self.sites.append(site(self.path, line, column, kind, signal or self.source(node),
                               self.guards + extra_guards, ".".join(self.owner), channel))

    @contextmanager
    def context(self, *guards, owner=None):
        previous_guards, previous_owner = self.guards, self.owner
        self.guards += guards
        if owner:
            self.owner += (owner,)
        try:
            yield
        finally:
            self.guards, self.owner = previous_guards, previous_owner

    def terminal(self, statements):
        for statement in statements:
            if isinstance(statement, (ast.Raise, ast.Return, ast.Break, ast.Continue)):
                return True
            if isinstance(statement, ast.If) and self.terminal(statement.body) and self.terminal(statement.orelse):
                return True
            if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call):
                name = dotted(statement.value.func)
                if name in self.fail_helpers or name in EXIT_CALLS or name.endswith("parser.error"):
                    return True
        return False

    def block(self, statements):
        with self.context():
            for node in statements:
                self.visit(node)
                if self.terminal([node]):
                    line, _ = self.location(node)
                    self.guards += (f"unreachable after unconditional exit at L{line}",)
                elif isinstance(node, ast.If):
                    stop_then, stop_else = self.terminal(node.body), self.terminal(node.orelse)
                    condition = self.source(node.test)
                    line, _ = self.location(node)
                    if stop_then != stop_else:
                        test = f"not ({condition})" if stop_then else condition
                        self.guards += (f"{test} [earlier exit at L{line}]",)

    def visit_Module(self, node):
        self.block(node.body)

    def visit_FunctionDef(self, node):
        with self.context(owner=node.name):
            self.block(node.body)

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_ClassDef = visit_FunctionDef

    def visit_If(self, node):
        self.visit(node.test)
        condition = self.source(node.test)
        with self.context(condition):
            self.block(node.body)
        with self.context(f"not ({condition})"):
            self.block(node.orelse)

    def visit_IfExp(self, node):
        self.visit(node.test)
        condition = self.source(node.test)
        with self.context(condition):
            self.visit(node.body)
        with self.context(f"not ({condition})"):
            self.visit(node.orelse)

    def visit_BoolOp(self, node):
        with self.context():
            for value in node.values:
                self.visit(value)
                condition = self.source(value)
                if isinstance(node.op, ast.Or):
                    condition = f"not ({condition})"
                self.guards += (condition,)

    def visit_For(self, node):
        self.visit(node.iter)
        condition = f"for {self.source(node.target)} in {self.source(node.iter)}"
        with self.context(condition):
            self.block(node.body)
        with self.context(f"loop completed without break: {condition}"):
            self.block(node.orelse)

    visit_AsyncFor = visit_For

    def visit_While(self, node):
        self.visit(node.test)
        condition = self.source(node.test)
        with self.context(f"while {condition}"):
            self.block(node.body)
        with self.context(f"loop completed without break: while {condition}"):
            self.block(node.orelse)

    def visit_With(self, node):
        for item in node.items:
            self.visit(item.context_expr)
        self.block(node.body)

    visit_AsyncWith = visit_With

    def visit_Try(self, node):
        self.block(node.body)
        prior = []
        for handler in node.handlers:
            cond = f"except {self.source(handler.type)}" if handler.type else "bare except"
            with self.context(*prior, cond + (f" as {handler.name}" if handler.name else "")):
                self.block(handler.body)
            prior.append(f"not caught by {cond}")
        line, _ = self.location(node)
        with self.context(f"try at L{line} completes without exception or exit"):
            self.block(node.orelse)
        with self.context(f"finally for try at L{line}"):
            self.block(node.finalbody)

    visit_TryStar = visit_Try

    def visit_Match(self, node):
        self.visit(node.subject)
        prior = []
        for case in node.cases:
            cond = f"match {self.source(node.subject)} case {self.source(case.pattern)}"
            if case.guard:
                with self.context(*prior, cond):
                    self.visit(case.guard)
                cond += f" if {self.source(case.guard)}"
            with self.context(*prior, cond):
                self.block(case.body)
            prior.append(f"not ({cond})")

    def comprehension(self, node, *values):
        with self.context():
            for generator in node.generators:
                self.visit(generator.iter)
                self.guards += (f"for {self.source(generator.target)} in {self.source(generator.iter)}",)
                for condition in generator.ifs:
                    self.visit(condition)
                    self.guards += (self.source(condition),)
            for value in values:
                self.visit(value)

    def visit_ListComp(self, node):
        self.comprehension(node, node.elt)

    visit_SetComp = visit_ListComp
    visit_GeneratorExp = visit_ListComp

    def visit_DictComp(self, node):
        self.comprehension(node, node.key, node.value)

    def visit_Raise(self, node):
        exc = node.exc
        if exc is None:
            self.add(node, "forward", channel="exception")
        elif dotted(exc) == "SystemExit":
            return
        elif isinstance(exc, ast.Call) and dotted(exc.func).split(".")[-1] == "SystemExit":
            self.exit_site(node, exc.args[0] if exc.args else None)
        else:
            details = [*exc.args, *(k.value for k in exc.keywords)] if isinstance(exc, ast.Call) else []
            carries_authored = any(fixed_text(value) or type(literal(value)) is int for value in details)
            dynamic = (details and not carries_authored) or (isinstance(exc, ast.Name) and exc.id[0].islower())
            self.add(node, "forward" if dynamic else "throw", channel="exception")
        self.generic_visit(node)

    def visit_Assert(self, node):
        self.add(node, "reject", channel="assertion", extra_guards=(f"not ({self.source(node.test)})",))
        self.generic_visit(node)

    def exit_site(self, node, status):
        if status is not None and not (isinstance(status, ast.Constant) and status.value in (0, None)):
            kind = "forward"
            conditions = ()
            if isinstance(status, ast.Compare):
                conditions = (self.source(status),)
                kind = "exit"
            elif isinstance(status, ast.IfExp):
                condition = self.bad_branch("exit_code", status)
                if condition is not None:
                    conditions = (condition,) if condition else ()
                    kind = "exit"
            elif isinstance(status, ast.Constant) or fixed_text(status):
                kind = "exit"
            self.add(node, kind, channel="process-exit", extra_guards=conditions)

    def visit_Return(self, node):
        value = node.value
        if isinstance(value, ast.Tuple) and len(value.elts) > 1 and literal(value.elts[0]) is False:
            if any(nonempty(part) for part in value.elts[1:]):
                self.add(node, "reject" if fixed_text(value) else "forward", channel="return-tuple")
        if isinstance(value, ast.Constant) and value.value is False and self.guards:
            self.add(node, "reject", channel="boolean-gate")
        if self.owner and self.owner[-1] in self.cli_main:
            if isinstance(value, ast.IfExp) or type(literal(value)) is int:
                self.exit_site(node, value)
        self.generic_visit(node)

    def bad_branch(self, key, node):
        """Return None for no identified failure, '' for a locally unconditional one."""
        if isinstance(node, ast.IfExp):
            yes, no = self.bad_branch(key, node.body), self.bad_branch(key, node.orelse)
            if yes == no and yes in (None, ""):
                return yes
            test = self.source(node.test)
            paths = []
            if yes is not None:
                paths.append(f"({test})" + (f" and ({yes})" if yes else ""))
            if no is not None:
                paths.append(f"not ({test})" + (f" and ({no})" if no else ""))
            return " or ".join(f"({path})" for path in paths) if len(paths) > 1 else paths[0]
        value = literal(node)
        if key in BOOLEAN_FIELDS and value is BOOLEAN_FIELDS[key]:
            return ""
        if key in EXIT_FIELDS and type(value) is int and value != 0:
            return ""
        if key in STATE_FIELDS and (isinstance(value, str) and value.lower() in BAD_STATES
                                    or type(value) is int and 400 <= value <= 599):
            return ""
        return None

    def payload(self, entries, anchor, channel, render):
        failures = [(key, value, self.bad_branch(key, value)) for key, value in entries]
        failures = [(key, value, branch) for key, value, branch in failures if branch is not None]
        facts = [(key, value) for key, value in entries if key in DIAGNOSTIC_FIELDS and nonempty(value)]
        if failures or facts:
            facts += [(key, value) for key, value in entries if key in CONTEXT_FIELDS and nonempty(value)]
        if not failures and not facts:
            return
        evidence = [(key, value) for key, value, _ in failures]
        paths = [branch for _, _, branch in failures]
        condition = " or ".join(f"({branch})" for branch in paths) if paths and all(paths) else ""
        extra = (condition,) if condition else ()
        authored, forwarded = [], []
        for key, value in facts:
            group = authored if fixed_text(value) or isinstance(value, ast.Constant) else forwarded
            group.append((key, value))
        if authored or (evidence and not forwarded):
            kind = "warning" if channel == "warning-collector" or any(key in WARNING_FIELDS for key, _ in authored) else "result"
            items = evidence + authored
            self.add(anchor(items[0]), kind, render(items), channel=channel, extra_guards=extra)
        if forwarded:
            self.add(anchor(forwarded[0]), "forward", render(evidence + forwarded), channel=channel, extra_guards=extra)

    def visit_Dict(self, node):
        channel = self.payload_channels.get(node, "payload")
        if channel:
            entries = [(literal(key), value) for key, value in zip(node.keys, node.values)
                       if isinstance(literal(key), str)]
            keys = {literal(key): key for key in node.keys if isinstance(literal(key), str)}

            def render(items):
                fragments = [f"{self.source(keys[key])}: {self.source(value)}" for key, value in items]
                return "{" + ", ".join(fragments) + "}"

            self.payload(entries, lambda item: keys[item[0]], channel, render)
        self.generic_visit(node)

    def assignment(self, node, targets, value):
        if value is None:
            return
        for target in targets:
            if isinstance(target, ast.Subscript) and isinstance(literal(target.slice), str):
                key = literal(target.slice)
                self.payload([(key, value)], lambda _: target, "field-write", lambda _: self.source(node))

    def visit_Assign(self, node):
        self.assignment(node, node.targets, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        self.assignment(node, [node.target], node.value)
        self.generic_visit(node)

    def call_kind(self, node, name):
        tail = name.split(".")[-1]
        first = node.args[0] if node.args else None
        if name in EXIT_CALLS:
            self.exit_site(node, first)
        elif name in self.fail_helpers or (name.startswith("self.") and tail in self.fail_helpers):
            helper = self.fail_helpers[tail]
            details = helper.exc.args if isinstance(helper.exc, ast.Call) else []
            authored = not node.args or any(fixed_text(part) for part in [*node.args, *details])
            self.add(node, "reject" if authored else "forward", channel="raise-helper")
        elif tail in {"respond", "send_error", "send_response", "HTTPException"}:
            status = literal(first if first is not None else next((k.value for k in node.keywords if k.arg == "status_code"), None))
            if type(status) is int and 400 <= status <= 599:
                body = node.args[1] if len(node.args) > 1 else next((k.value for k in node.keywords if k.arg == "detail"), None)
                if isinstance(body, ast.Dict):
                    self.payload_channels[body] = None
                kind = "reject" if body is None or fixed_text(body) else "forward"
                self.add(node, kind, channel="http")
            elif len(node.args) > 1 and isinstance(node.args[1], ast.Dict):
                self.payload_channels[node.args[1]] = "http-payload"
        elif tail in {"send", "_send", "emit", "write_frame"} and isinstance(literal(first), str):
            if literal(first).lower() in {"error", "failed", "failure", "rejected", "warning"}:
                body = node.args[-2] if len(node.args) > 1 and literal(node.args[-1]) is True else node.args[-1]
                if isinstance(body, ast.Dict):
                    self.payload_channels[body] = None
                kind = "warning" if literal(first).lower() == "warning" else "reject"
                self.add(node, kind if fixed_text(body) else "forward", channel="protocol-frame")
        elif name == "print" or any(name.endswith(f"{stream}.write") or name.endswith(f"{stream}.buffer.write")
                                    for stream in ("stderr", "stdout")):
            self.print_site(node, name)
        elif tail in {"warn", "warning", "critical", "exception", "record_failure", "error"}:
            channel = "argparse" if "parser" in name and tail == "error" else "diagnostic-call"
            kind = "warning" if tail in {"warn", "warning"} else "reject" if channel == "argparse" else "result"
            self.add(node, kind if any(fixed_text(arg) for arg in node.args) else "forward", channel=channel)
        elif tail == "add_argument":
            self.argument_site(node)
        elif tail == "exit" and "parser" in name:
            self.exit_site(node, first if first is not None else next((k.value for k in node.keywords if k.arg == "status"), None))
        elif tail in {"append", "extend", "add"} and isinstance(node.func, ast.Attribute) and node.args:
            target = node.func.value
            receiver = literal(target.slice) if isinstance(target, ast.Subscript) else dotted(target).split(".")[-1]
            if receiver in ISSUE_COLLECTORS:
                if isinstance(first, ast.Dict):
                    self.payload_channels[first] = "warning-collector" if receiver in WARNING_FIELDS else "issue-collector"
                else:
                    textual = fixed_text(first) or isinstance(first, (ast.Name, ast.Subscript)) or (
                        isinstance(first, ast.Call) and dotted(first.func) in {"str", "repr"})
                    if textual:
                        kind = "warning" if receiver in WARNING_FIELDS else "result"
                        self.add(node, kind if fixed_text(first) else "forward", channel="issue-collector")
        elif tail in {"update", "compare_update", "merge", "save", "_save"} and node.keywords:
            entries = [(item.arg, item.value) for item in node.keywords if item.arg]

            def render(items):
                fragments = [f"{key}={self.source(value)}" for key, value in items]
                return f"{name}(" + ", ".join(fragments) + ")"

            self.payload(entries, lambda _: node, "field-update", render)
        elif name == "base64.b64encode" and isinstance(literal(first), (str, bytes)):
            value = json_literal(literal(first))
            if isinstance(value, dict) and set(value) == {"code"} and isinstance(value["code"], str):
                self.add(first, "result", channel="protocol-payload")

    def print_site(self, node, name):
        first = node.args[0] if node.args else None
        value = literal(first)
        stderr = "stderr" in name.split(".") or any(item.arg == "file" and dotted(item.value) in {"sys.stderr", "stderr"}
                                                    for item in node.keywords)
        if name == "print" and isinstance(value, str) and value.lstrip().startswith("{"):
            payload = json_literal(value)
            if isinstance(payload, dict):
                state = payload.get("status")
                if (payload.get("ok") is False or payload.get("isError") is True or payload.get("error")
                        or isinstance(state, str) and state in BAD_STATES):
                    self.add(node, "result", channel="stdout")
                    return
        def text_parts(part):
            value = literal(part)
            if isinstance(value, (str, bytes)):
                yield str(value)
            elif isinstance(part, (ast.JoinedStr, ast.BinOp, ast.BoolOp)):
                for child in ast.iter_child_nodes(part):
                    yield from text_parts(child)
        wording = " ".join(text_parts(first))
        if stderr or re.search(r"\b(?:error|warning|failed|fatal|blocked|cannot)\b", wording, re.I):
            kind = "warning" if re.search(r"\bwarning\b", wording, re.I) else "result"
            self.add(node, kind if any(fixed_text(arg) for arg in node.args) else "forward",
                     channel="stderr" if stderr else "protocol-frame" if ":ERROR:" in wording else "stdout")

    def argument_site(self, node):
        if not node.args:
            return
        name = literal(node.args[0])
        if not isinstance(name, str):
            return
        options = {item.arg: item.value for item in node.keywords if item.arg}
        positional_required = not name.startswith("-") and literal(options.get("nargs")) not in {"?", "*"}
        typed = "type" in options and dotted(options["type"]) != "str"
        if literal(options.get("required")) is True or "choices" in options or positional_required or typed:
            self.add(node, "reject", channel="argparse-schema", extra_guards=("argument binding / conversion",))

    def visit_Call(self, node):
        self.call_kind(node, dotted(node.func))
        self.generic_visit(node)

    def shell_parts(self, node):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return self.shell_parts(node.left) + self.shell_parts(node.right)
        if isinstance(literal(node), str) and "\n" not in node.value:
            self.shell_literals.add(node)
            return [(node.value, node)]
        return [(f"[generated from {ast.unparse(node)}]", None)]

    def visit_List(self, node):
        values = [literal(element) for element in node.elts]
        if "fi" in values and any(isinstance(value, str) and re.fullmatch(SHELL_EXIT, value.strip()) for value in values):
            parts = [self.shell_parts(element) for element in node.elts]
            script = "\n".join("".join(text for text, _ in line) for line in parts)
            for row in shell_sites(self.path, script, owner=".".join((*self.owner, "<embedded>")),
                                   guards=self.guards, channel="embedded-shell"):
                command = row["signal"].split(None, 1)[0]
                offset = row["column"] - 1
                for text, token in parts[row["line"] - 1]:
                    if offset < len(text):
                        if token is not None:
                            line, column = self.location(token)
                            position = self.source(token).find(command)
                            row.update(line=line, column=column + max(0, position))
                            self.sites.append(row)
                        break
                    offset -= len(text)
        self.generic_visit(node)

    def scan_literal(self, node, language, code, quoted, substitutions=()):
        line, column = self.location(node)
        if not quoted:
            self.coverage.append(f"{self.path}:{line}: joined literal tokens have no single physical source span")
            return
        column += len(quoted[1]) + len(quoted[2])
        owner = (*self.owner, "<embedded>")
        guards = self.guards
        if substitutions:
            guards += ("generated source has unresolved interpolation",)
        locations = LiteralLocations(code, quoted[3], line, column)
        if language == "python":
            scanner = PythonSites(self.path, code, owner=owner, tag="embedded-python")
            try:
                tree = ast.parse(code)
            except SyntaxError:
                self.coverage.append(f"{self.path}:{line}: incomplete generated Python; only standalone diagnostic clauses checked")
                rows = python_fragment_sites(self.path, code, owner)
            else:
                scanner.scan(tree)
                rows = scanner.sites
        else:
            wrapper = {"cmd": cmd_sites, "powershell": powershell_sites, "shell": shell_sites}[language]
            rows = wrapper(self.path, code)

        placeholders = [target for target, _ in substitutions]
        for row in rows:
            physical = locations.project(row['line'], row['column'])
            if physical is None or any(part in row['signal'] for part in placeholders):
                continue
            row['line'], row['column'] = physical
            if language != 'python':
                row['owner'] = ".".join(owner)
                row['channel'] = 'embedded-' + row['channel']
            else:
                row['guard'] = locations.project_guard(row['guard'])
            for target, original in substitutions:
                row['guard'] = row['guard'].replace(target, original)
            row['guard'] = " | ".join((*guards, row['guard']) if row['guard'] else guards)
            self.sites.append(row)

    def visit_JoinedStr(self, node):
        if not self.tag:
            quoted = STRING_SOURCE.fullmatch(self.source(node))
            if quoted and PYTHON_START.match(quoted[3]):
                pieces, substitutions = [], []
                for part in node.values:
                    if isinstance(part, ast.Constant):
                        pieces.append(part.value)
                    else:
                        slot = f"__generated_expression_{len(substitutions)}__"
                        pieces.append(slot)
                        substitutions.append((slot, "{" + self.source(part.value) + "}"))
                line, _ = self.location(node)
                self.coverage.append(f"{self.path}:{line}: Python f-string interpolation unresolved; literal diagnostic clauses checked")
                self.scan_literal(node, "python", "".join(pieces), quoted, substitutions)
        for part in node.values:
            if isinstance(part, ast.FormattedValue):
                self.visit(part)

    def visit_Constant(self, node):
        value = node.value
        if self.tag or node in self.shell_literals or not isinstance(value, str):
            return
        if PYTHON_START.match(value):
            language = "python"
        elif CMD_START.search(value):
            language = "cmd"
        elif POWERSHELL_START.search(value):
            language = "powershell"
        elif SHELL_FAILURE.search(value) and re.search(r"(?:^\s*#!|\|\|\s*exit|^[ \t]*(?:exit|echo|printf)\b)", value, re.M):
            language = "shell"
        else:
            return
        self.scan_literal(node, language, value, STRING_SOURCE.fullmatch(self.source(node)))


class LiteralLocations:
    """Locate a decoded literal's statically aligned characters in the physical host file."""

    def __init__(self, code, original, line, column):
        self.code_lines = code.split("\n")
        self.line_starts = [0, *(match.end() for match in re.finditer(r"\n", code))]
        self.original, self.line, self.column = original, line, column
        self.matches = SequenceMatcher(None, code, original, autojunk=False).get_matching_blocks() if code != original else None

    def project(self, line, column):
        if not 1 <= line <= len(self.line_starts):
            return None
        index = self.line_starts[line - 1] + column - 1
        if self.matches is not None:
            match = next((entry for entry in self.matches if entry.a <= index < entry.a + entry.size), None)
            if match is None:
                return None
            index += match.b - match.a
        breaks = self.original.count("\n", 0, index)
        return self.line + breaks, index - self.original.rfind("\n", 0, index) if breaks else self.column + index

    def project_guard(self, guard):
        def replace_line(match):
            line = int(match[1])
            if 1 <= line <= len(self.line_starts):
                code = self.code_lines[line - 1]
                physical = self.project(line, len(code) - len(code.lstrip()) + 1)
                if physical:
                    return f"L{physical[0]}"
            return f"generated line {line}"

        return re.sub(r"(?<= at )L(\d+)\b", replace_line, guard)


def python_fragment_sites(path, code, owner):
    """Check standalone Python clauses where the complete generated fragment cannot parse."""
    scopes = []
    for line, raw in enumerate(code.split("\n"), 1):
        part = raw.lstrip(" \t")
        if not part or part.startswith("#"):
            continue
        indent = len(raw) - len(part)
        while scopes and scopes[-1][0] >= indent:
            scopes.pop()
        header = re.fullmatch(r"((?:if|elif|else|for|while|except|finally|with|try)\b.*):\s*(?:#.*)?", part)
        if header:
            scopes.append((indent, header[1]))
            continue
        if not re.search(r"\braise\s|\b(?:exit|error|warning|warn|send_error)\s*\(|stderr\.(?:buffer\.)?write\s*\(", part):
            continue
        try:
            tree = ast.parse(part)
        except SyntaxError:
            continue
        guards = (*(scope[1] for scope in scopes), "surrounding generated Python unresolved")
        scanner = PythonSites(path, part, owner=owner, guards=guards, tag="embedded-python-fragment",
                              line_offset=line - 1, first_column_offset=indent)
        scanner.scan(tree)
        yield from scanner.sites


def json_literal(value):
    try:
        return json.loads(value)
    except (ValueError, UnicodeError):
        return None


def cmd_sites(path, source):
    conditions = []
    for line_number, raw in enumerate(source.splitlines(), 1):
        line = raw.strip()
        inline = re.fullmatch(r"if\s+(errorlevel\s+\d+)\s+(exit\s+.+)", line, re.I)
        if inline:
            line = inline[2]
        guards = (*conditions, inline[1]) if inline else conditions
        branch = re.fullmatch(r"if\s+(.+?)\s*\(", line, re.I)
        if branch:
            conditions.append(branch[1])
        elif re.fullmatch(r"\)\s*else\s*\(", line, re.I) and conditions:
            conditions[-1] = f"not ({conditions[-1]})"
        elif line == ")" and conditions:
            conditions.pop()
        elif re.match(r"echo\s+", line, re.I):
            yield site(path, line_number, raw.index(line) + 1, "ui", line, guards, "<launcher>", "cmd")
        elif re.match(r"exit\s+(?:/b\s+)?(?:[1-9]\d*|%[^%]+%)", line, re.I):
            kind = "forward" if "%" in line else "exit"
            yield site(path, line_number, raw.index(line) + 1, kind, line, guards, "<launcher>", "cmd")


def nsis_sites(path, source):
    languages = {}
    for raw in source.splitlines():
        item = re.match(r'\s*LangString\s+(\w+)\s+(\d+)\s+(".*")\s*$', raw)
        if item:
            languages.setdefault(item[1], []).append(raw.strip())
    scopes, owners, jumps = [], [], []
    instruction = 0
    for line_number, raw in enumerate(source.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        declaration = re.match(r"(?:!macro|Function)\s+(\w+)\b", line)
        if declaration:
            owners.append(declaration[1])
            continue
        if line in {"!macroend", "FunctionEnd"}:
            owners.pop()
            jumps.clear()
            continue
        logical = re.match(r"\$\{(If|IfNot|AndIf|AndIfNot|OrIf|OrIfNot|Else|ElseIf|EndIf)\}(?:\s+(.*))?$", line)
        if logical:
            operation, expression = logical.groups()
            if operation in {"If", "IfNot"}:
                scopes.append(expression if operation == "If" else f"not ({expression})")
            elif operation == "EndIf":
                scopes.pop()
            elif operation == "Else":
                scopes[-1] = f"not ({scopes[-1]})"
            elif operation == "ElseIf":
                scopes[-1] = f"not ({scopes[-1]}) and ({expression})"
            else:
                connector = "and" if operation.startswith("And") else "or"
                rhs = f"not ({expression})" if operation.endswith("Not") else f"({expression})"
                scopes[-1] = f"({scopes[-1]}) {connector} {rhs}"
            continue
        if line.startswith(("!", "LangString ")):
            continue
        jumps = [(until, guard) for until, guard in jumps if until > instruction]
        branch = re.match(r"(?:IfFileExists|StrCmp)\b.*\s0\s\+(\d+)$", line)
        if branch:
            jumps.append((instruction + int(branch[1]), f"fallthrough at L{line_number}: {line}"))
        guards = (*scopes, *(guard for _, guard in jumps))
        owner = ".".join(owners) or "<installer>"
        column = raw.index(line) + 1
        if re.match(r"MessageBox\b.*\bMB_ICON(?:STOP|EXCLAMATION)", line):
            localized = [definition for name in re.findall(r"\$\((\w+)\)", line)
                         for definition in languages.get(name, ())]
            yield site(path, line_number, column, "ui", "\n".join([line, *localized]), guards, owner, "nsis")
        elif line == "Abort" or re.match(r"SetErrorLevel\s+[1-9]\d*", line):
            yield site(path, line_number, column, "exit", line, guards, owner, "nsis")
        instruction += 1


def mask_powershell(line):
    """Preserve character offsets while hiding quoted text and comments."""
    masked = []
    quote = None
    escaped = False
    for index, character in enumerate(line):
        if not quote and not escaped and character == "#":
            masked.extend(" " * (len(line) - index))
            break
        if escaped:
            masked.append(" ")
            escaped = False
        elif character == "`" and quote != "'":
            masked.append(" ")
            escaped = True
        elif character == quote:
            masked.append(" ")
            quote = None
        elif quote:
            masked.append(" ")
        elif character in "\"'":
            masked.append(" ")
            quote = character
        else:
            masked.append(character)
    return "".join(masked)


def powershell_command(path, line, line_number, column, scopes, owner):
    match = re.match(r"(throw|exit|Write-(?:Error|Warning)|\[Console\]::Error\.Write(?:Line)?)\b", line, re.I)
    if not match:
        return None
    operation = match[1].lower()
    argument = line[match.end():].strip()
    if operation == "exit":
        if not argument or argument == "0":
            return None
        kind = "exit" if re.fullmatch(r"[1-9]\d*", argument) else "forward"
    elif operation == "throw":
        kind = "throw" if argument and not argument.startswith("$_") else "forward"
    elif operation.startswith("write-warning"):
        kind = "warning" if "$_" not in argument else "forward"
    else:
        kind = "result" if "$_" not in argument else "forward"
    return site(path, line_number, column, kind, line, scopes, owner, "powershell")


def powershell_sites(path, source):
    scopes = []
    prior = ()
    here_end = None
    owner = "<script>"
    for line_number, raw in enumerate(source.splitlines(), 1):
        if here_end:
            if raw.strip() == here_end:
                here_end = None
            elif re.match(r"\s*if\s*\(.*\)\s*throw\s", raw):
                condition, signal = re.split(r"\s+(?=throw\s)", raw.strip(), maxsplit=1)
                yield site(path, line_number, raw.index(signal) + 1, "throw", signal,
                           (condition,), "<embedded C#>", "powershell-here-string")
            continue
        here = re.search(r"@(['\"])\s*$", raw)
        if here:
            here_end = here[1] + "@"
            continue
        if re.match(r"^\s*\[(?:Parameter\(Mandatory\)|ValidateSet\()", raw):
            clause = raw.strip().rstrip(",")
            yield site(path, line_number, raw.index(clause) + 1, "reject", clause,
                       ("parameter binding",), owner, "powershell-parameter")
        guards = tuple(condition for scope in scopes for condition in scope)
        if re.search(r"\bConvertTo-Json\b", raw) and re.search(r"status\s*=.*['\"](?:blocked|failed)['\"]", raw, re.I):
            contested = re.search(r"status\s*=\$\(if\s*\(([^)]+)\)", raw, re.I)
            extra = (contested[1],) if contested else ()
            yield site(path, line_number, len(raw) - len(raw.lstrip()) + 1, "result", raw, guards + extra, owner, "powershell-json")

        masked = mask_powershell(raw)
        start = depth = 0
        for index, character in enumerate(masked + ";"):
            if character == "(":
                depth += 1
            elif character == ")":
                depth = max(0, depth - 1)
            if depth or character not in "{};":
                continue
            raw_part = raw[start:index]
            part = raw_part.strip()
            column = start + len(raw_part) - len(raw_part.lstrip()) + 1
            start = index + 1
            if character == "{":
                header = re.fullmatch(r"(if|elseif|while|for|foreach|switch)\s*\((.*)\)", part, re.I)
                if header:
                    control = header[1].lower()
                    condition = header[2] if control in {"if", "elseif"} else part
                    scopes.append((*prior, condition) if control == "elseif" else (condition,))
                elif part.lower() == "else":
                    scopes.append(prior)
                elif re.match(r"(?:catch|finally)\b", part, re.I):
                    scopes.append((part,))
                else:
                    scopes.append(())
                prior = ()
                continue
            guards = tuple(condition for scope in scopes for condition in scope)
            output = powershell_command(path, part, line_number, column, guards, owner)
            if output:
                yield output
            if character == "}" and scopes:
                closed = scopes.pop()
                prior = (*closed[:-1], f"not ({closed[-1]})") if closed else ()
            elif part:
                prior = ()


def shell_sites(path, source, *, owner="<script>", guards=(), line_offset=0, first_column_offset=0, channel="shell"):
    conditions = []
    for index, raw in enumerate(source.splitlines()):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        branch = re.match(r"(?:if|elif)\s+(.+?)\s*;\s*then\b\s*(.*)$", line)
        if branch:
            if line.startswith("elif ") and conditions:
                conditions[-1] = f"not ({conditions[-1]}) and ({branch[1]})"
            else:
                conditions.append(branch[1])
            line = branch[2]
        if line in {"fi", "else"}:
            if conditions and line == "fi":
                conditions.pop()
            elif conditions:
                conditions[-1] = f"not ({conditions[-1]})"
            continue
        exit_call = re.search(rf"(?:^|\|\||&&)\s*({SHELL_EXIT})(?=\s|;|$)", line)
        if exit_call:
            original = exit_call[1]
            prefix = line[:exit_call.start()].strip() or "preceding generated command"
            context = (f"{prefix} failed",) if exit_call[0].startswith("||") else ()
            if exit_call[0].startswith("&&"):
                context = (f"{prefix} succeeded",)
            kind = "forward" if "$" in original else "exit"
            column_offset = first_column_offset if index == 0 else 0
            yield site(path, index + 1 + line_offset, raw.index(original) + 1 + column_offset,
                       kind, original, (*guards, *conditions, *context), owner, channel)
        elif re.fullmatch(r"(?:status|rc|exit_code)=[1-9]\d*", line):
            column_offset = first_column_offset if index == 0 else 0
            yield site(path, index + 1 + line_offset, raw.index(line) + 1 + column_offset,
                       "result", line, (*guards, *conditions), owner, channel)
        elif re.match(r"(?:echo|printf)\s+", line) and re.search(r"(?:>&\s*2|/dev/stderr)", line):
            column_offset = first_column_offset if index == 0 else 0
            yield site(path, index + 1 + line_offset, raw.index(line) + 1 + column_offset,
                       "result", line, (*guards, *conditions), owner, channel)
        if re.search(r";\s*fi\s*$", line) and conditions:
            conditions.pop()


WRAPPER_SCANNERS = {
    ".bat": cmd_sites,
    ".cmd": cmd_sites,
    ".nsh": nsis_sites,
    ".nsi": nsis_sites,
    ".ps1": powershell_sites,
    ".sh": shell_sites,
}


JS_TEMPLATE = re.compile(
    r"(?m)^[ \t]*(?:export[ \t]+)?const[ \t]+([\w$]+)[ \t]*=[ \t]*"
    r"(?:[\w$]+[ \t]*\+[ \t]*)?(String\.raw)?`((?:\\.|[^`\\])*)`",
    re.S,
)


def javascript_python_sites(path, source):
    rows, coverage = [], []
    for fragment in JS_TEMPLATE.finditer(source):
        name, raw_tag, code = fragment.groups()
        if not re.match(r"\s*(?:import\s+\w|from\s+[.\w]+\s+import\s|\w+\s*=\s*\{|\"\"\"|''')", code):
            continue
        start = fragment.start(3)
        line = source.count("\n", 0, start) + 1
        column = start - source.rfind("\n", 0, start)
        if re.search(r"(?<!\\)\$\{", code) or (not raw_tag and "\\" in code):
            coverage.append(f"{path}:{line}: interpolated or escaped JavaScript template; Python locations unavailable")
            continue
        try:
            tree = ast.parse(code)
        except SyntaxError:
            coverage.append(f"{path}:{line}: JavaScript template is not a complete Python fragment")
            continue
        scanner = PythonSites(path, code, owner=(name,), tag="embedded-python",
                              line_offset=line - 1, first_column_offset=column - 1)
        scanner.scan(tree)
        rows.extend(scanner.sites)
    return rows, coverage


def extract(root, entries):
    rows, coverage = [], []
    for entry in sorted(set(entries)):
        relative = Path(entry.replace("\\", "/"))
        source_file = (root / relative).resolve(strict=True)
        if relative.is_absolute() or not source_file.is_relative_to(root):
            raise ValueError(f"Expected a path inside the repo: {entry}")
        name = relative.as_posix()
        source = source_file.read_text(encoding="utf-8-sig")
        suffix = relative.suffix.lower()
        if suffix == ".py":
            scanner = PythonSites(name, source)
            scanner.scan(ast.parse(source, filename=name))
            rows.extend(scanner.sites)
            coverage.extend(scanner.coverage)
        elif suffix in {".js", ".mjs", ".cjs"}:
            embedded, gaps = javascript_python_sites(name, source)
            rows.extend(embedded)
            coverage.extend(gaps)
        elif suffix in WRAPPER_SCANNERS:
            rows.extend(WRAPPER_SCANNERS[suffix](name, source))
        else:
            raise ValueError(f"Unsupported source type: {name}")
    rows.sort(key=lambda row: (row["path"], row["line"], row["column"], row["kind"], row["signal"]))
    return rows, sorted(set(coverage))


def main():
    entries = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    if not isinstance(entries, list) or any(not isinstance(entry, str) for entry in entries):
        raise ValueError("Expected a JSON array of repo-relative source paths")
    rows, coverage = extract(Path.cwd().resolve(), entries)
    for row in rows:
        sys.stdout.buffer.write((json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8"))
    for warning in coverage:
        sys.stderr.buffer.write((warning + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
