import ast
import unittest

from python_sites import PythonSites, cmd_sites, javascript_python_sites, nsis_sites, powershell_sites


def python_rows(source):
    scan = PythonSites("sample.py", source)
    scan.scan(ast.parse(source))
    return scan.sites


class PythonInventoryTests(unittest.TestCase):
    def test_guards_owner_and_unicode_location(self):
        source = '''def check(path, allowed):
    if not path:
        return False
    try:
        match path:
            case "known" if allowed:
                return True
            case "known":
                note = "权限"; raise PermissionError("Approval required")
            case _:
                fail("unknown_path")
    except PermissionError as exc:
        return {"status": "blocked", "code": "permission_denied", "reason": str(exc)}
def fail(code):
    raise ValueError(code)
'''
        rows = python_rows(source)
        raised = next(row for row in rows if row["signal"] == 'raise PermissionError("Approval required")')
        self.assertEqual((raised["line"], raised["column"], raised["owner"]), (9, source.splitlines()[8].index("raise") + 1, "check"))
        self.assertIn("not (not path) [earlier exit at L2]", raised["guard"])
        self.assertIn('not (match path case "known" if allowed)', raised["guard"])
        helper = next(row for row in rows if row["channel"] == "raise-helper")
        self.assertEqual(helper["kind"], "reject")
        body = [row for row in rows if row["channel"] == "payload"]
        self.assertEqual([row["kind"] for row in body], ["result", "forward"])
        self.assertIn('"code": "permission_denied"', body[0]["signal"])
        self.assertIn('"reason": str(exc)', body[1]["signal"])
        self.assertIn("except PermissionError as exc", body[1]["guard"])

    def test_state_branch_warning_http_and_cli_exit(self):
        source = '''import sys
def main():
    warnings.append({"reason": "Input may be stale"})
    state.update(status="failed" if retries else "passed", reason=str(error) if retries else None)
    if error:
        endpoint.respond(403, {"error": str(error)})
    return 0 if completed else 2
sys.exit(main())
'''
        rows = python_rows(source)
        warning = next(row for row in rows if row["kind"] == "warning")
        self.assertIn("Input may be stale", warning["signal"])
        update = next(row for row in rows if row["channel"] == "field-update")
        self.assertIn("retries", update["guard"])
        denied = next(row for row in rows if row["channel"] == "http")
        self.assertEqual((denied["guard"], denied["kind"]), ("error", "forward"))
        codes = [row for row in rows if row["channel"] == "process-exit"]
        self.assertEqual([(row["kind"], row["guard"]) for row in codes], [("exit", "not (completed)"), ("forward", "")])

    def test_embedded_python_and_shell_use_host_locations(self):
        source = '''helper = r"""import sys
if flag: raise ValueError('Invalid flag')
"""
def batch(root):
    return "\\n".join(['cd ' + root + ' || exit 1', 'if check; then',
                       ' status=$?', 'else', ' status=65', 'fi', 'exit "$status"'])
'''
        rows = python_rows(source)
        err = next(row for row in rows if row["channel"] == "embedded-python/exception")
        self.assertEqual((err["line"], err["column"], err["guard"]), (2, 10, "flag"))
        shell = [row for row in rows if row["channel"] == "embedded-shell"]
        self.assertEqual([row["signal"] for row in shell], ["exit 1", "status=65", 'exit "$status"'])
        self.assertIn("root", shell[0]["guard"])
        self.assertEqual(shell[1]["guard"], "not (check)")
        for row in shell:
            self.assertTrue(source.splitlines()[row["line"] - 1][row["column"] - 1:].startswith(row["signal"]))

    def test_interpolated_python_template_preserves_literal_sites_and_host_guards(self):
        source = """def render(allowed, base, members):
    if not allowed: raise PermissionError('Review required')
    return f'''import sys
class Bias({base}):
    {members}
if __name__ == '__main__':
    config = {{'float': True}}
    if not all(atoms.pbc):
        raise ValueError('Explicit full PBC required')
    if index >= len(atoms):
        raise ValueError('Atom index exceeds structure')
'''
"""
        rows = [row for row in python_rows(source) if row['channel'] == 'embedded-python/exception']
        self.assertEqual([(row['line'], row['column']) for row in rows], [(9, 9), (11, 9)])
        self.assertIn('not (not allowed) [earlier exit at L2]', rows[0]['guard'])
        self.assertIn('generated source has unresolved interpolation', rows[0]['guard'])
        self.assertIn('not all(atoms.pbc)', rows[0]['guard'])
        self.assertIn('not (not all(atoms.pbc)) [earlier exit at L8]', rows[1]['guard'])
        self.assertIn('index >= len(atoms)', rows[1]['guard'])

    def test_unparseable_generated_python_keeps_standalone_literal_raise(self):
        source = """source = '''import sys
if ready:
    raise ValueError('File unavailable')
class ''' + name
"""
        row, = python_rows(source)
        self.assertEqual((row['line'], row['column']), (3, 5))
        self.assertEqual(row['signal'], "raise ValueError('File unavailable')")
        self.assertEqual(row['guard'], 'if ready | surrounding generated Python unresolved')

    def test_generated_launchers_keep_exit_tokens_on_one_physical_line(self):
        source = r'''python = "#!" + interpreter + "\nfrom entrypoints.cli import main\nraise SystemExit(main())\n"
cmd = '@echo off\ncd /d "' + home + '"\nif errorlevel 1 exit /b 1\n' + command + '\nexit /b %errorlevel%\n'
powershell = "Set-Location -LiteralPath " + home + "\nexit $LASTEXITCODE\n"
'''
        rows = python_rows(source)
        self.assertEqual([row['signal'] for row in rows], ['raise SystemExit(main())', 'exit /b 1',
            'exit /b %errorlevel%', 'exit $LASTEXITCODE'])
        self.assertEqual([row['kind'] for row in rows], ['forward', 'exit', 'forward', 'forward'])
        self.assertEqual(rows[1]['guard'], 'errorlevel 1')
        for row in rows:
            self.assertTrue(source.splitlines()[row['line'] - 1][row['column'] - 1:].startswith(row['signal']))

    def test_javascript_template_uses_host_locations(self):
        source = 'export const HELPER = String.raw`result = {"status": "unknown"}\nif stale: raise ValueError()\n`;\n'
        rows, gaps = javascript_python_sites("helper.mjs", source)
        self.assertEqual(gaps, [])
        self.assertEqual([(row["line"], row["owner"]) for row in rows], [(1, "HELPER"), (2, "HELPER")])
        self.assertEqual(rows[0]["column"], source.index('"status"') + 1)
        self.assertEqual(rows[1]["guard"], "stale")


class WrapperInventoryTests(unittest.TestCase):
    def test_cmd_nonzero_exit_and_user_output(self):
        source = '@echo off\nif errorlevel 1 (\n  echo Cannot start\n  exit /b %ERRORLEVEL%\n)\nexit /b 0\n'
        rows = list(cmd_sites("launch.cmd", source))
        self.assertEqual([(row["kind"], row["guard"]) for row in rows], [("ui", "errorlevel 1"), ("forward", "errorlevel 1")])

    def test_powershell_elseif_and_forwarded_catch(self):
        source = '''try {
    if ($Mode -eq 'Verify') { return }
    elseif ($Mode -eq 'Remove') { throw 'Conflicting folder: $name' }
    else { throw 'Unsupported mode' }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
'''
        rows = list(powershell_sites("install.ps1", source))
        self.assertEqual([row["kind"] for row in rows], ["throw", "throw", "forward", "exit"])
        self.assertEqual(rows[0]["guard"], "not ($Mode -eq 'Verify') | $Mode -eq 'Remove'")
        self.assertEqual(rows[1]["guard"], "not ($Mode -eq 'Verify') | not ($Mode -eq 'Remove')")
        self.assertEqual(rows[2]["guard"], "catch")

    def test_nsis_localization_and_relative_branches(self):
        source = '''LangString Locked 1033 "Close your workspace"
LangString Locked 2052 "关闭工作区"
!macro WorkspaceBusy
  IfFileExists "$INSTDIR/app.exe" 0 +4
  MessageBox MB_OK|MB_ICONSTOP "$(Locked)"
  SetErrorLevel 1
  Abort
!macroend
'''
        rows = list(nsis_sites("setup.nsh", source))
        self.assertEqual([row["kind"] for row in rows], ["ui", "exit", "exit"])
        self.assertIn("关闭工作区", rows[0]["signal"])
        self.assertIn('IfFileExists "$INSTDIR/app.exe" 0 +4', rows[0]["guard"])
        self.assertEqual(rows[0]["owner"], "WorkspaceBusy")


if __name__ == "__main__":
    unittest.main()
