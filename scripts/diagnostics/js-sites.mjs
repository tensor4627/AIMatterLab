import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const sourceText = node => node?.getText() ?? '';
const adverse = /(?:\b|_)(?:abort(?:ed)?|blocked|cannot|conflict|could not|denied|disconnected|error(?:s)?|fail(?:ed|ure|ures)?|incompatible|incomplete|invalid|mismatch|missing|not(?: |_)allowed|not(?: |_)available|not(?: |_)confirmed|not(?: |_)found|not(?: |_)supported|permission_required|problem|refused|reject(?:ed|ion)?|timeout|timed_out|unable|unavailable|uncertain|unconfirmed|unexpected|unhealthy|unsupported|unverified|warning(?:s)?|wrong)(?:\b|_)|失败|错误|拒绝|异常|超时|无法|不能|不可用|不可读|不支持|不一致|不兼容|无效|未通过|未就绪|暂未|尚未(?:确认|复核|核验)|尚待|未刷新|未能|已阻止|已断开|缺少|缺失|缺项|需(?:要)?(?:核对|认证|维护|更新|重新检查)|先(?:连接|恢复|选择|完成|核对)/iu;
const routineStatusCopy = /\b(?:loading|saving|refreshing|connecting|syncing|completed|passed|succeeded|ready|connected|saved|verified)\b|正在(?:加载|读取|保存|同步|刷新|核对|检查|连接)|(?:复核|准备|检查|验证|构建|更新|同步|保存)(?:已)?(?:完成|通过)|已(?:连接|就绪|保存|登记|刷新|核验)/iu;
const negativeStates = new Set([
  'aborted', 'blocked', 'cancelled', 'denied', 'disconnected', 'error', 'failed',
  'incompatible', 'incomplete', 'invalid', 'maintenance_required', 'mismatch',
  'missing', 'needs_auth', 'needs_human_auth', 'needs_worker_update', 'permission_required',
  'registration_required', 'rejected', 'requires_review', 'superseded', 'timed_out', 'unavailable',
  'unconfirmed', 'unhealthy', 'unknown', 'unsupported', 'warning',
]);
const stateKeys = new Set(['status', 'state', 'phase', 'outcome', 'severity']);
const falseKeys = new Set(['accepted', 'allowed', 'eligible', 'ok', 'success', 'supported', 'valid']);
const trueKeys = new Set(['blocked', 'failed', 'isError', 'renderBlocked']);
const detailKey = /^(?:error|warning|failure|issue|problem|blocker|violation|diagnostic)s?$|^missing(?:Fields|_fields)$|^(?:[a-z]+_)*(?:error|warning|failure|issue|blocker)s$|(?:Errors|Warnings|Failures|Issues|Blockers)$/;
const collectionKey = /^(?:errors|warnings|issues|failures|problems|violations|blockers|reasons|findings|missingFields|missing_fields)$|(?:Errors|Warnings|Issues|Failures|Blockers|Findings)$/;
const messageKey = /^(?:message|reason|reasons|summary|detail|details|hint|next_step|next_required_action|block_reason|failure_reason|error_code|code|content|contentItems|text)$/;
const localized = /^(?:t|tr|m|msg|say|L|l10n|translate)$/;
const diagnosticReturn = /(?:DiagnosticSummary|ErrorMessage|FailureMessage|RejectedMessage|BlockReason|UnsupportedCode|Issue|ErrorText|DiagnosticNotice)$|(?:^|\.)(?:cliError|safeSshServiceError|sshConnectionMessage|terminalMessage|localReviewNotice|versionFailure)$/i;
const routineControl = /^(?:a|button|input|label|option|select|summary|textarea)$/;
const collectionMethods = new Set(['every', 'filter', 'find', 'findIndex', 'flatMap', 'forEach', 'map', 'reduce', 'some']);
const joinedPayloads = new Set(['assign', 'stringify', 'freeze']);

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
  return node;
}

function literal(node) {
  node = unwrap(node);
  if (node && ts.isStringLiteralLike(node)) return node.text;
  if (node && ts.isNumericLiteral(node)) return Number(node.text);
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
}

function nameOf(node) {
  node = unwrap(node);
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) || ts.isComputedPropertyName(node)) {
    const key = literal(node.argumentExpression ?? node.expression);
    return typeof key === 'string' ? key : '';
  }
  return '';
}

function callable(node) {
  return !!node && (ts.isCallExpression(node) || ts.isNewExpression(node));
}

function errorConstructor(node) {
  return callable(node) && /^(?:[A-Z][\w$]*)?(?:Error|Exception|Fault)$/.test(nameOf(node.expression));
}

function meaningfulString(value) {
  return typeof value === 'string' && /[\p{L}\p{N}]/u.test(value);
}

function isEmpty(node) {
  node = unwrap(node);
  return !node || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isIdentifier(node) && node.text === 'undefined') || literal(node) === ''
    || (ts.isArrayLiteralExpression(node) && !node.elements.length)
    || (ts.isObjectLiteralExpression(node) && !node.properties.length);
}

function functionName(node) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return nameOf(node.name) || (
    node.parent && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)
      || ts.isPropertyDeclaration(node.parent)) ? nameOf(node.parent.name) : ''
  );
}

function ownerOf(node) {
  const names = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    const name = ts.isFunctionLike(parent) ? functionName(parent)
      : ts.isClassLike(parent) ? nameOf(parent.name) : '';
    if (name) names.unshift(name);
  }
  return names.join('.') || '<module>';
}

function callbackContext(fn) {
  let child = fn;
  while (child.parent && ts.isParenthesizedExpression(child.parent)) child = child.parent;
  const call = child.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(child)) return '';
  const callee = call.expression;
  const name = nameOf(callee);
  if (name === 'catch' || (name === 'then' && call.arguments[1] === child)) return 'promise rejection';
  if (name === 'setTimeout' || name === 'setInterval') return `${name}(..., ${sourceText(call.arguments[1])})`;
  if (ts.isPropertyAccessExpression(callee) && collectionMethods.has(name)) {
    return `${sourceText(callee)} callback (${fn.parameters.map(sourceText).join(', ')})`;
  }
  if (['on', 'once', 'addEventListener'].includes(name) && typeof literal(call.arguments[0]) === 'string') {
    return `${sourceText(callee)}(${sourceText(call.arguments[0])}, callback)`;
  }
  return '';
}

function negativePredicate(node) {
  node = unwrap(node);
  return node && ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken
    ? sourceText(node.operand) : `!(${sourceText(node)})`;
}

function diagnosticPredicate(node, truthy) {
  node = unwrap(node);
  if (!node) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return diagnosticPredicate(node.operand, !truthy);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      const left = diagnosticPredicate(node.left, truthy), right = diagnosticPredicate(node.right, truthy);
      const requiresBoth = (op === ts.SyntaxKind.AmpersandAmpersandToken) === truthy;
      return requiresBoth ? left || right : left && right;
    }
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op)) {
      const equality = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
      const value = literal(node.right) ?? literal(node.left);
      const key = nameOf(literal(node.right) === undefined ? node.right : node.left);
      if (negativeStates.has(value)) return equality === truthy;
      if (falseKeys.has(key) && typeof value === 'boolean') return (value !== (equality === truthy));
      if (value === 'passed' || value === 'ready' || value === 'connected') return equality !== truthy;
      return false;
    }
  }
  const terminal = callable(node) ? node.expression : node;
  const name = nameOf(terminal) === 'length' ? nameOf(terminal.expression) : nameOf(terminal);
  return truthy && /(?:error|fail(?:ure|ed)?|block(?:ed|ers)?|denied|conflict|warn(?:ing)?|missing|invalid|unconfirmed|unsupported|needs(?:HumanAuth|WorkerUpdate)|disconnect|timeout|recovery)/i.test(name)
    || !truthy && /(?:connected|enabled|ready|valid|supported|available|compatible|authorized)$/i.test(name);
}

function contextualGuards(anchor, alwaysThrows) {
  const guards = [];
  const predicate = (node, truthy) => ({
    text: truthy ? sourceText(node) : negativePredicate(node), adverse: diagnosticPredicate(node, truthy),
  });
  const context = (text, adverse = false) => ({text, adverse});
  const exits = statement => !!statement && (
    ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBreakStatement(statement)
    || ts.isContinueStatement(statement) || ts.isBlock(statement) && exits(statement.statements.at(-1))
    || ts.isExpressionStatement(statement) && alwaysThrows(unwrap(statement.expression))
  );
  for (let child = anchor, parent = child.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      if (child === parent.thenStatement) guards.push(predicate(parent.expression, true));
      if (child === parent.elseStatement) guards.push(predicate(parent.expression, false));
    } else if (ts.isConditionalExpression(parent)) {
      if (child === parent.whenTrue) guards.push(predicate(parent.condition, true));
      if (child === parent.whenFalse) guards.push(predicate(parent.condition, false));
    } else if (ts.isBinaryExpression(parent) && child === parent.right) {
      if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) guards.push(predicate(parent.left, true));
      if (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) guards.push(predicate(parent.left, false));
      if (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        guards.push(context(`${sourceText(parent.left)} == null`));
      }
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      if (child !== parent.expression) {
        const selector = sourceText(parent.parent.parent.expression);
        const test = ts.isCaseClause(parent) ? `case ${sourceText(parent.expression)}` : 'default';
        guards.push(context(`switch (${selector}) ${test}`, negativeStates.has(literal(parent.expression))));
      }
    } else if (ts.isCatchClause(parent)) {
      guards.push(context(parent.variableDeclaration ? `catch (${sourceText(parent.variableDeclaration)})` : 'catch', true));
    } else if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      if (child === parent.statement) {
        const op = ts.isForOfStatement(parent) ? 'of' : 'in';
        guards.push(context(`for (${sourceText(parent.initializer)} ${op} ${sourceText(parent.expression)})`));
      }
    } else if (ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isForStatement(parent)) {
      if (child === parent.statement) guards.push(context(`loop (${sourceText(parent.expression ?? parent.condition)})`));
    } else if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      // Earlier sibling gates can establish the current branch without an enclosing else.
      const previous = parent.statements.slice(0, parent.statements.indexOf(child)).reverse();
      let found = 0;
      for (const stmt of previous) {
        if (!ts.isIfStatement(stmt)) continue;
        const thenExits = exits(stmt.thenStatement), elseExits = exits(stmt.elseStatement);
        if (thenExits === elseExits) continue;
        guards.push({...predicate(stmt.expression, elseExits), adverse: false});
        if (++found === 2) break;
      }
    } else if (ts.isFunctionLike(parent)) {
      const callback = callbackContext(parent);
      if (callback) guards.push(context(callback, callback === 'promise rejection' || /\(['"]error['"]/.test(callback)));
      if (!callback) break;
    }
  }
  return guards.reverse().filter((entry, index, all) => all.findIndex(prior => prior.text === entry.text) === index);
}

function jsxAttributes(element) {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.attributes.properties.filter(ts.isJsxAttribute);
}

function jsxValue(attribute) {
  const init = attribute?.initializer;
  return init && ts.isJsxExpression(init) ? init.expression : init;
}

function includesJsx(node) {
  return node && (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)
    || !!ts.forEachChild(node, child => includesJsx(child) || undefined));
}

function jsxContext(node) {
  let alert = false, diagnostic = false, tag = '';
  for (let p = node.parent; p && !ts.isReturnStatement(p); p = p.parent) {
    if (ts.isJsxAttribute(p)) return {hidden: true};
    if (!ts.isJsxElement(p)) continue;
    tag ||= sourceText(p.openingElement.tagName);
    if (routineControl.test(sourceText(p.openingElement.tagName))) return {hidden: true};
    const attrs = jsxAttributes(p);
    const role = jsxValue(attrs.find(attr => nameOf(attr.name) === 'role'));
    const classes = jsxValue(attrs.find(attr => nameOf(attr.name) === 'className'));
    const className = literal(classes) ?? '';
    const testId = literal(jsxValue(attrs.find(attr => nameOf(attr.name) === 'data-testid'))) ?? '';
    if (className === 'approval' || testId === 'agent-question-request') return {hidden: true};
    alert ||= literal(role) === 'alert' || (role && ts.isConditionalExpression(role)
      && [literal(role.whenTrue), literal(role.whenFalse)].includes('alert'));
    diagnostic ||= /(?:^|[\s_-])(?:error|errors|warning|blocked|failure|diagnostic)(?:$|[\s_-])/.test(className)
      || /(?:^|-)(?:error|warning|failure|diagnostic)$/.test(testId);
  }
  return {alert, diagnostic, tag};
}

function messageBranches(value) {
  const node = unwrap(value);
  if (!node) return [];
  if (ts.isConditionalExpression(node)) {
    return [...messageBranches(node.whenTrue), ...messageBranches(node.whenFalse)];
  }
  if (callable(node) && localized.test(nameOf(node.expression)) && node.arguments?.length === 1
    && ts.isConditionalExpression(unwrap(node.arguments[0]))) return messageBranches(node.arguments[0]);
  return [value];
}

function nameTokens(name) {
  return name.replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .split(/[^a-z\d]+/i).map(token => token.toLowerCase());
}

function ordinaryStatusCopy(value) {
  return typeof value === 'string' && !adverse.test(value) && routineStatusCopy.test(value);
}

function terminalArgument(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) return true;
  if (ts.isConditionalExpression(parent) && node !== parent.condition || unwrap(parent) === unwrap(node)) {
    return terminalArgument(parent);
  }
  if (ts.isBinaryExpression(parent) && node === parent.right) {
    if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return true;
    if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]
      .includes(parent.operatorToken.kind)) return terminalArgument(parent);
  }
  return ts.isCallExpression(parent) && (joinedPayloads.has(nameOf(parent.expression)) || /^(?:send|resolve|respond)$/.test(nameOf(parent.expression)));
}

function scanFile(source, file, checker) {
  const rows = [];
  const anchors = new Set();
  const covered = new Set();
  const summaries = new Map();
  const functionsByCall = new WeakMap();
  const rejectionParameters = new WeakMap();
  const knownCatalogs = new Set();
  const isFrontend = file.startsWith('frontend/');

  function binding(node) {
    node = unwrap(node);
    if (!node) return;
    let symbol = node.parent && ts.isShorthandPropertyAssignment(node.parent) && node === node.parent.name
      ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }

  function initializer(node) {
    const declaration = binding(node);
    return declaration && ts.isVariableDeclaration(declaration)
      && declaration.parent.flags & ts.NodeFlags.Const ? unwrap(declaration.initializer) : undefined;
  }

  function catalogLookup(receiver) {
    let value = initializer(receiver) ?? unwrap(receiver);
    if (callable(value) && sourceText(value.expression) === 'Object.freeze') value = unwrap(value.arguments?.[0]);
    return knownCatalogs.has(value);
  }

  function functionForCall(call) {
    if (!functionsByCall.has(call)) {
      const declaration = binding(call.expression);
      const fn = declaration?.initializer ?? declaration;
      functionsByCall.set(call, fn && ts.isFunctionLike(fn) && fn.body ? fn : undefined);
    }
    return functionsByCall.get(call);
  }

  function rejectedArgument(call) {
    const args = call.arguments ?? [];
    if (!args.length) return;
    const fn = functionForCall(call);
    if (!fn) return;
    if (!rejectionParameters.has(fn)) {
      const indices = new Set();
      const visit = node => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isCallExpression(node) && nameOf(node.expression) === 'reject') {
          const index = fn.parameters.indexOf(binding(node.arguments[0]));
          if (index >= 0) indices.add(index);
        }
        ts.forEachChild(node, visit);
      };
      visit(fn.body);
      rejectionParameters.set(fn, [...indices]);
    }
    return rejectionParameters.get(fn).map(index => args[index]).find(value => !isEmpty(value));
  }

  function authored(node, depth = 0) {
    node = unwrap(node);
    if (!node || depth >= 7) return false;
    const has = value => authored(value, depth + 1);
    if (ts.isStringLiteralLike(node)) return meaningfulString(node.text);
    if (ts.isTemplateExpression(node)) {
      return meaningfulString(node.head.text) || node.templateSpans.some(span => meaningfulString(span.literal.text) || has(span.expression));
    }
    if (ts.isConditionalExpression(node)) return has(node.whenTrue) || has(node.whenFalse);
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return has(node.right);
      return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(op)
        && (has(node.left) || has(node.right));
    }
    if (ts.isIdentifier(node)) return has(initializer(node));
    if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
      return catalogLookup(node.expression);
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(has);
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some(p => ts.isPropertyAssignment(p)
        && (messageKey.test(nameOf(p.name)) || detailKey.test(nameOf(p.name))) && has(p.initializer));
    }
    if (callable(node)) {
      const name = nameOf(node.expression);
      if (errorConstructor(node) || localized.test(name) || joinedPayloads.has(name)) return node.arguments?.some(has) ?? false;
      if (diagnosticReturn.test(name)) return node.arguments?.some(has) ?? false;
    }
    return false;
  }

  function variants(node, depth = 0) {
    node = unwrap(node);
    if (!node || depth >= 5) return [];
    if (ts.isConditionalExpression(node)) {
      return [...variants(node.whenTrue, depth + 1), ...variants(node.whenFalse, depth + 1)];
    }
    if (ts.isIdentifier(node) && initializer(node)) return variants(initializer(node), depth + 1);
    return [literal(node)];
  }

  function failureState(key, value) {
    const values = variants(value);
    return (stateKeys.has(key) || /(?:_status|Status)$/.test(key)) && values.some(state => negativeStates.has(state))
      || falseKeys.has(key) && values.includes(false)
      || trueKeys.has(key) && values.includes(true)
      || key === 'role' && values.includes('alert');
  }

  function resultParts(node, substitute = value => value) {
    const entries = node.properties.filter(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
      .map(p => ({property: p, key: nameOf(p.name), value: substitute(p.initializer ?? p.name)}));
    const bad = entries.filter(({key, value}) => failureState(key, value));
    const rawDiagnostic = entries.some(entry => entry.key === 'stack') && entries.some(entry => entry.key === 'context');
    const details = entries.filter(({key, value}) => (detailKey.test(key) || key === 'raw' && rawDiagnostic) && !isEmpty(value));
    const message = entries.filter(({key, value}) => messageKey.test(key) && !isEmpty(value));
    const code = message.find(entry => entry.key === 'code');
    const knownDiagnostic = code && message.length > 1
      && (diagnosticReturn.test(ownerOf(node)) || adverse.test(sourceText(code.value)));
    if (!bad.length && !details.length && !knownDiagnostic
      && !message.some(({key, value}) => key !== 'code' && authored(value) && adverse.test(sourceText(value)))) return;
    const fields = entries.filter(entry => bad.includes(entry) || details.includes(entry) || message.includes(entry));
    return {
      signal: fields.map(entry => sourceText(entry.property)).join(', '),
      local: bad.length > 0 || fields.some(entry => authored(entry.value)),
      warning: !bad.length && details.length > 0 && details.every(entry => /warning/i.test(entry.key)),
    };
  }

  function factory(call, visiting = new Set()) {
    if (!callable(call) || errorConstructor(call)) return;
    const fn = functionForCall(call);
    if (!fn || visiting.has(fn)) return;
    visiting.add(fn);
    let summary = summaries.get(fn);
    if (summary === undefined) {
      const last = ts.isBlock(fn.body) ? fn.body.statements.at(-1) : undefined;
      const simple = last && fn.body.statements.slice(0, -1).every(stmt =>
        ts.isVariableStatement(stmt) || ts.isExpressionStatement(stmt) || ts.isFunctionDeclaration(stmt));
      if (simple && ts.isThrowStatement(last)) summary = {kind: 'throw', value: last.expression};
      else {
        const expression = ts.isBlock(fn.body) ? simple && ts.isReturnStatement(last) && last.expression : fn.body;
        const value = unwrap(expression);
        if (value && ts.isObjectLiteralExpression(value)) summary = {kind: 'result', value};
        else if (value) summary = {kind: 'expression', value};
      }
      summaries.set(fn, summary ?? null);
    }
    if (summary?.kind === 'result') {
      const substitute = value => {
        const declared = binding(value);
        const index = fn.parameters.indexOf(declared);
        return index >= 0 ? call.arguments?.[index] ?? declared.initializer : value;
      };
      const result = resultParts(summary.value, substitute);
      return result && {kind: result.warning ? 'warning' : 'result', local: result.local};
    }
    if (summary?.kind === 'throw') return summary;
    if (summary?.kind === 'expression') {
      if (constructedError(summary.value, visiting)) return {kind: 'error_value'};
      return factory(summary.value, visiting);
    }
  }

  function constructedError(node, visiting = new Set()) {
    node = unwrap(node);
    if (!node || visiting.has(node)) return false;
    visiting.add(node);
    if (ts.isIdentifier(node)) return constructedError(initializer(node), visiting);
    if (!callable(node)) return false;
    if (errorConstructor(node)) return true;
    if (sourceText(node.expression) === 'Object.assign') return constructedError(node.arguments[0], visiting);
    return factory(node, visiting)?.kind === 'error_value';
  }

  const alwaysThrows = node => factory(node)?.kind === 'throw';
  const contextOf = node => contextualGuards(node, alwaysThrows);

  function add(anchor, kind, signal, extra = {}) {
    const start = anchor.getStart(source);
    if (anchors.has(start)) return;
    anchors.add(start);
    const {line, character} = source.getLineAndCharacterOfPosition(start);
    rows.push({
      path: file, line: line + 1, column: character + 1, kind, signal,
      guard: [...contextOf(anchor).map(entry => entry.text), ...(extra.trigger ? [extra.trigger] : [])].join(' → '),
      owner: ownerOf(anchor), ...extra,
    });
  }

  function emit(anchor, kind, payload, local = authored(payload), extra) {
    add(anchor, local ? kind : 'forward', sourceText(payload) || sourceText(anchor), extra);
    if (payload) covered.add(payload);
  }

  function insideCovered(node) {
    for (let p = node.parent; p && !ts.isFunctionLike(p); p = p.parent) {
      if (covered.has(p)) return true;
    }
    return covered.has(node);
  }

  function catalogObject(node) {
    let child = node;
    while (child.parent && (unwrap(child.parent) === node
      || ts.isCallExpression(child.parent) && sourceText(child.parent.expression) === 'Object.freeze')) child = child.parent;
    const holder = child.parent;
    if (!holder || file === 'frontend/ui/i18n.ts') return false;
    const inVariable = ts.isVariableDeclaration(holder) && holder.initializer === child;
    const isInline = ts.isElementAccessExpression(holder) && holder.expression === child;
    const isExtension = ts.isCallExpression(holder) && sourceText(holder.expression) === 'Object.assign'
      && holder.arguments.indexOf(child) > 0;
    const name = inVariable ? nameOf(holder.name)
      : isInline ? ownerOf(node)
      : isExtension ? nameOf(holder.arguments[0]) : '';
    const tokens = nameTokens(name);
    const named = tokens.some(token => /^(?:error|warning|failure|diagnostic|fault|refusal|blocker)s?$/.test(token))
      || inVariable && /Finding\[/.test(sourceText(holder.type));
    const generic = tokens.some(token => /^(?:message|reason|code)s?$/.test(token)) || name === 'mapped' || /StateLabel$/.test(name);
    if (!named && !generic) return false;
    const properties = node.properties.filter(p => ts.isPropertyAssignment(p) && nameOf(p.name)
      && !messageKey.test(nameOf(p.name)) && !stateKeys.has(nameOf(p.name)) && !detailKey.test(nameOf(p.name))
      && (meaningfulString(literal(p.initializer)) || /^\w*(?:MESSAGE|_ERROR)$/.test(sourceText(p.initializer))
        || named && ts.isArrayLiteralExpression(unwrap(p.initializer)) && authored(p.initializer)));
    if (!properties.length || properties.length < node.properties.length / 2) return false;
    const matches = properties.filter(p => {
      const key = nameOf(p.name), copy = literal(p.initializer);
      if (/StateLabel$/.test(name)) return negativeStates.has(key) || adverse.test(copy);
      return named || adverse.test(key) || negativeStates.has(key) || adverse.test(copy)
        || /(?:^|_)(?:changed|required|busy|exited)(?:_|$)/i.test(key);
    });
    if (!matches.length) return false;
    knownCatalogs.add(node);
    for (const property of matches) add(property, 'catalog', sourceText(property), {key: nameOf(property.name)});
    return true;
  }

  function errorFlow(anchor, kind, value) {
    const direct = unwrap(value);
    const previous = direct && ts.isIdentifier(direct) ? initializer(direct) : undefined;
    // Keep the origin at its own location, where construction may precede several emissions.
    if (previous && constructedError(previous)) emit(anchor, kind, value, false);
    else emit(anchor, kind, value, authored(value) || (callable(direct)
      && (direct.arguments?.some(arg => authored(arg)) || errorConstructor(direct) && !direct.arguments?.length)));
  }

  function visitObject(node) {
    if (knownCatalogs.has(node) || insideCovered(node)) return;
    const result = resultParts(node);
    if (!result) return;
    add(node, result.local ? result.warning ? 'warning' : 'result' : 'forward', result.signal);
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && (detailKey.test(nameOf(prop.name)) || messageKey.test(nameOf(prop.name)))) {
        covered.add(prop.initializer);
      }
    }
  }

  function visitCall(node) {
    if (insideCovered(node)) return;
    const target = sourceText(node.expression), name = nameOf(node.expression);
    const args = node.arguments ?? [];
    const first = args[0];
    if (name === 'reject') return errorFlow(node, 'reject', first);
    if (nameOf(first) === 'reject' && args[1] && !['catch', 'then', 'on', 'once'].includes(name)) {
      return errorFlow(node, 'reject', args[1]);
    }
    const rejected = rejectedArgument(node);
    if (rejected) return errorFlow(node, 'reject', rejected);
    if (name === 'throwIfAborted') return emit(node, 'throw', node, false);
    if (name === 'showErrorBox' || /(?:^|\.)(?:alert|reportLaunchFailure)$/.test(target)) {
      return emit(node, 'ui', node, args.some(value => authored(value)));
    }
    if (/^(?:console\.(?:error|warn)|process\.stderr\.write|(?:log|logger|toast)\.(?:error|warn|warning))$/.test(target)) {
      return emit(node, 'warning', node, args.some(value => authored(value)) || args.some(value => resultPartsFromExpression(value)));
    }
    if (/^(?:process|app)\.exit$/.test(target) && first && variants(first).some(value => value !== 0)) {
      return emit(node, 'exit', node, true);
    }
    if (['send', 'status', 'writeHead'].includes(name) && variants(first).some(value => Number.isInteger(value) && value >= 400 && value < 600)) {
      return emit(node, 'result', node, true);
    }
    if (ts.isPropertyAccessExpression(node.expression) && ['add', 'push', 'unshift'].includes(name)
      && collectionKey.test(nameOf(node.expression.expression)) && args.length) {
      return emit(node, /warning/i.test(target) ? 'warning' : 'result', node, args.some(value => authored(value)));
    }
    if (isFrontend && first && !isEmpty(first)) {
      if (/^(?:on(?:Error|Warning|Failure)|report(?:Error|Failure)|showIssues|set(?:[A-Z]\w*)?(?:Errors?|Warnings?|Issues?|Diagnostics?|Problems?))$/.test(name)
        && ![true, false].includes(literal(first))) return emit(node, 'ui', first);
      if (/^set(?:\w+)?(?:Notice|Status|Message|Banner|Feedback)$/.test(name)) {
        return visitMessages(first, {anchor: node, noticeSetter: true});
      }
    }
    if (isFrontend && ((name === 'catch' && /^on(?:Error|Warning|Failure)$/.test(nameOf(first)))
      || (name === 'then' && /^on(?:Error|Warning|Failure)$/.test(nameOf(args[1]))))) {
      return emit(node, 'ui', node, false, {trigger: 'promise rejection'});
    }
    const behavior = factory(node);
    if (behavior?.kind === 'throw') {
      const supplied = args.some(value => authored(value)), fixed = !supplied && authored(behavior.value);
      return emit(node, 'throw', node, supplied || fixed, fixed ? {definition: sourceText(behavior.value)} : undefined);
    }
    if ((behavior?.kind === 'result' || behavior?.kind === 'warning') && terminalArgument(node)) {
      return emit(node, behavior.kind, node, behavior.local);
    }
    if (constructedError(node)) {
      const local = authored(node) || args.some(value => authored(value));
      return emit(node, 'error_value', node, local);
    }
    if (isFrontend && localized.test(name) && first && authored(first) && adverse.test(sourceText(first))) {
      if (!jsxContext(node).hidden && contextOf(node).some(entry => entry.adverse)) visitMessages(node);
    }
    if (isFrontend && localized.test(name) && first && authored(first) && ts.isElementAccessExpression(unwrap(first))
      && catalogLookup(unwrap(first).expression) && !jsxContext(node).hidden) {
      emit(node, 'ui', node);
    }
  }

  function resultPartsFromExpression(node) {
    node = unwrap(node);
    if (node && ts.isObjectLiteralExpression(node)) return !!resultParts(node)?.local;
    if (callable(node) && nameOf(node.expression) === 'stringify') return resultPartsFromExpression(node.arguments?.[0]);
    return false;
  }

  function visitAssignment(node) {
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || insideCovered(node)) return;
    const {left, right} = node;
    if (sourceText(left) === 'process.exitCode' && !isEmpty(right) && literal(right) !== 0) {
      return emit(node, 'exit', node, true);
    }
    if (!(ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left))) return;
    const key = nameOf(left);
    const receiver = nameOf(left.expression);
    if (failureState(key, right)) return emit(node, 'result', node, true);
    if (key === 'code' && (constructedError(initializer(left.expression)) || /error|fault|exception/i.test(receiver))) {
      return emit(node, 'error_code', node, authored(right));
    }
    if (!isEmpty(right) && (collectionKey.test(receiver) || detailKey.test(key))) {
      // Object literals with their own result fields are reported at that more specific location.
      if (!resultPartsFromExpression(right)) emit(node, /warning/i.test(receiver || key) ? 'warning' : 'result', node, authored(right));
    }
  }

  function visitReturn(node, expression) {
    if (!expression || isEmpty(expression) || insideCovered(node)) return;
    const value = unwrap(expression);
    if (callable(value) && (!localized.test(nameOf(value.expression)) || constructedError(value))) return;
    if (ts.isObjectLiteralExpression(value) || includesJsx(value)) return;
    const owner = ownerOf(node);
    for (const branch of messageBranches(expression)) {
      if (isEmpty(branch)) continue;
      const anchor = branch === expression ? node : branch;
      const guard = contextOf(anchor);
      const strings = variants(branch).filter(meaningfulString);
      if (strings.some(text => /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}$/.test(text) && adverse.test(text))
        || diagnosticReturn.test(owner) && (authored(branch) || guard.some(entry => entry.adverse))
        || guard.some(entry => entry.adverse) && strings.some(text => negativeStates.has(text) || adverse.test(text))) {
        emit(anchor, isFrontend ? 'ui' : 'result', branch);
      }
    }
  }

  function visitCollection(node) {
    const name = nameOf(node.name);
    if (insideCovered(node) || !collectionKey.test(name) || ownerOf(node) === '<module>') return;
    let value = unwrap(node.initializer);
    if (callable(value) && nameOf(value.expression) === 'Set') value = unwrap(value.arguments?.[0]);
    if (value && ts.isArrayLiteralExpression(value) && value.elements.some(item => authored(item))) {
      emit(node, /warning/i.test(name) ? 'warning' : 'result', value, true);
    }
  }

  function visitMessages(expression, {anchor = expression, alert = false, diagnostic = false, tag = '', noticeSetter = false} = {}) {
    for (const branch of messageBranches(expression)) {
      const rowAt = branch === expression ? anchor : branch;
      const guard = contextOf(rowAt);
      const text = sourceText(branch);
      const badText = adverse.test(text) || variants(branch).some(state => negativeStates.has(state));
      const adverseGuard = guard.some(entry => entry.adverse);
      const localizedCopy = ts.isJsxText(branch) ? branch.getText().trim()
        : literal(branch) ?? (callable(branch) && localized.test(nameOf(branch.expression)) && literal(branch.arguments?.[0]));
      const longCopy = typeof localizedCopy === 'string' && (/[.!?。！？；]/.test(localizedCopy) || localizedCopy.length >= 8);
      const reference = /(?:Error|Warning|Notice|Problem|Conflict|Blocker|Issue|Failure|Reason|Diagnostic|error|warning|notice|message|raw|reason|stack)\b/.test(text);
      const authoredCopy = ts.isJsxText(branch) ? meaningfulString(localizedCopy) : authored(branch);
      if (isEmpty(branch) || ts.isJsxText(branch) && (!authoredCopy || /^(?:SHA256|ID|GPU)\b/.test(localizedCopy))) continue;
      if (ordinaryStatusCopy(localizedCopy)) continue;
      if (guard.some(entry => /confirmRemove|approval|pendingRequests/.test(entry.text)) && !badText) continue;
      if (alert || diagnostic) {
        if (!badText && !reference && !(authoredCopy && longCopy) && !['p', 'strong', 'h2', 'h3'].includes(tag)) continue;
        if (!authoredCopy && !reference && !badText) continue;
      } else if (!(badText && (guard.length || noticeSetter) || adverseGuard && (longCopy || reference))) continue;
      emit(rowAt, 'ui', branch, authoredCopy);
    }
    covered.add(expression);
  }

  function visitJsx(node) {
    if (insideCovered(node)) return;
    const context = jsxContext(node);
    if (context.hidden) return;
    const expr = ts.isJsxExpression(node) ? node.expression : node;
    if (!expr || includesJsx(expr) || ts.isJsxAttribute(node.parent) || isEmpty(expr)) return;
    visitMessages(expr, {...context, anchor: node});
  }

  function visitJsxAttribute(node) {
    const attribute = nameOf(node.name), value = jsxValue(node);
    const tag = sourceText(node.parent.parent.tagName);
    if (!value || isEmpty(value)) return;
    if (/(?:Diagnostic|ErrorNotice|FailureNotice|WarningNotice)/.test(tag)
      && (detailKey.test(attribute) || /^(?:record|records|notice|message)$/.test(attribute))) emit(node, 'ui', value);
  }

  // Register the lookup tables first so an earlier use can resolve a later declaration.
  const catalogs = node => {
    if (ts.isObjectLiteralExpression(node)) catalogObject(node);
    ts.forEachChild(node, catalogs);
  };
  catalogs(source);

  function visit(node) {
    if (ts.isThrowStatement(node)) errorFlow(node, 'throw', node.expression);
    else if (callable(node)) visitCall(node);
    else if (ts.isObjectLiteralExpression(node)) visitObject(node);
    else if (ts.isBinaryExpression(node)) visitAssignment(node);
    else if (ts.isReturnStatement(node)) visitReturn(node, node.expression);
    else if (ts.isVariableDeclaration(node)) visitCollection(node);
    else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) visitReturn(node.body, node.body);
    else if (ts.isJsxExpression(node) || ts.isJsxText(node)) visitJsx(node);
    else if (ts.isJsxAttribute(node)) visitJsxAttribute(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return rows.sort((a, b) => a.line - b.line || a.column - b.column);
}

function normalizePaths(input) {
  if (!Array.isArray(input)) throw Error('Expected a JSON array of repository-relative JavaScript/TypeScript paths');
  const files = new Set();
  for (const item of input) {
    if (typeof item !== 'string' || !item || path.win32.isAbsolute(item) || /^[A-Za-z]:/.test(item)) {
      throw Error('Every source path must be relative to the repository root');
    }
    const segments = item.replaceAll('\\', '/').split('/');
    if (segments.includes('..')) throw Error('Source paths must stay within the repository');
    const file = path.posix.normalize(segments.join('/'));
    if (!/\.[cm]?[jt]sx?$/i.test(file)) throw Error(`Unsupported source extension: ${file}`);
    if (/\.d\.[cm]?ts$|(?:^|\/)(?:__tests__|tests|test|fixtures|node_modules)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file)) continue;
    files.add(file);
  }
  return [...files];
}

const files = normalizePaths(JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')));
const program = ts.createProgram(files.map(file => path.resolve(file)), {
  allowJs: true, noLib: true, noResolve: true, noEmit: true,
  target: ts.ScriptTarget.Latest, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve,
});
const checker = program.getTypeChecker();
const sources = files.map(file => {
  const source = program.getSourceFile(path.resolve(file));
  if (!source) throw Error(`Source could not be read: ${file}`);
  const diagnostics = program.getSyntacticDiagnostics(source);
  if (diagnostics.length) {
    throw Error(`Cannot scan ${file}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`);
  }
  return source;
});
for (const [index, source] of sources.entries()) {
  const rows = scanFile(source, files[index], checker);
  if (rows.length) process.stdout.write(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}
