import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve('vite'))('postcss');
const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = resolve(root, 'frontend');
const baselinePath = resolve(root, 'scripts/frontend-style-baseline.json');
const overlayFiles = [
  'ux-finish.css', 'project-navigation.css', 'workspace-shell.css',
  'navigation.css', 'frontend-refinement.css', 'interactions.css',
];
const metrics = {
  colorLiterals: 0,
  importantDeclarations: 0,
  browserDialogs: 0,
  inlineNotices: 0,
  bareAlerts: 0,
  unnamedIconButtons: 0,
  buttonTitles: 0,
  pixelFontSizes: 0,
  literalBorderRadii: 0,
  overlayStylesheets: 0,
};

function* filesUnder(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path);
    if (entry.isFile()) yield path;
  }
}

function checkCss(path, source) {
  const colorValue = /#[\da-f]{3,8}\b|\brgba?\(/gi;
  const css = parse(source, { from: path });
  const isTokens = path === 'ui/tokens.css';
  const isTerminalOrEditor = /(?:^|\/)(?:terminal\/|[^/]*editor[^/]*\.css$)/.test(path);
  css.walkDecls(({ prop, value, important }) => {
    // Remove comments, URLs and quoted strings before counting color functions.
    const declarations = value.replace(/\/\*[^]*?\*\/|url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi, '');
    if (!isTokens) metrics.colorLiterals += declarations.match(colorValue)?.length ?? 0;
    if (important) metrics.importantDeclarations += 1;
    if (!isTokens && !isTerminalOrEditor && prop === 'font-size' && /\d(?:\.\d+)?px\b/.test(declarations)) {
      metrics.pixelFontSizes += 1;
    }
    if (!isTokens && /^(?:border-radius|border-.+-radius)$/.test(prop)) {
      const radii = declarations.replace(/var\(--[\w-]+\)/g, '');
      metrics.literalBorderRadii += (radii.match(/\d*\.?\d+(?:px|rem|em|%)/g) ?? [])
        .filter(radius => Number.parseFloat(radius) !== 0 && radius !== '50%').length;
    }
  });
}

function attributes(tag) {
  return new Map(tag.attributes.properties.filter(ts.isJsxAttribute)
    .map(attribute => [attribute.name.getText(), attribute.initializer]));
}

function attributeText(attribute) {
  if (!attribute) return '';
  return ts.isStringLiteral(attribute) ? attribute.text : attribute.expression?.getText() ?? '';
}

function checkSource(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isProperty = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee);
      const member = isProperty && (callee.name?.text ?? callee.argumentExpression?.text);
      if (isProperty && /^(window|globalThis)$/.test(callee.expression.getText()) && /^(confirm|alert|prompt)$/.test(member)) {
        metrics.browserDialogs += 1;
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      const attrs = attributes(node);
      const classes = attributeText(attrs.get('className'));
      if (/(?:^|[\s'"`])notice(?=$|[\s'"`])/.test(classes)) metrics.inlineNotices += 1;
      if (tag === 'p' && attributeText(attrs.get('role')).replace(/^['"]|['"]$/g, '') === 'alert') {
        metrics.bareAlerts += 1;
      }
      if (tag === 'button' || tag === 'Button') {
        if (attrs.has('title')) metrics.buttonTitles += 1;
        const icon = /(?:^|[\s'"`])icon-button(?=$|[\s'"`])/.test(classes)
          || attributeText(attrs.get('variant')).replace(/^['"]|['"]$/g, '') === 'icon';
        if (icon && !attrs.has('aria-label') && !attrs.has('aria-labelledby')) metrics.unnamedIconButtons += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}

for (const path of filesUnder(frontend)) {
  const extension = extname(path);
  if (!['.css', '.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(extension)) continue;
  const name = relative(frontend, path).replaceAll('\\', '/');
  const source = readFileSync(path, 'utf8');
  if (extension === '.css') checkCss(name, source);
  else checkSource(name, source);
}
metrics.overlayStylesheets = overlayFiles.filter(name => existsSync(join(frontend, 'app', name))).length;

if (process.argv.includes('--report')) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  for (const [name, count] of Object.entries(metrics)) {
    const limit = baseline[name];
    if (!Number.isInteger(limit) || limit < 0) {
      console.error(`${name}: missing or invalid stylesheet baseline`);
      process.exitCode = 1;
    } else if (count > limit) {
      console.error(`${name}: ${count} exceeds baseline ${limit}`);
      process.exitCode = 1;
    } else if (count < limit) {
      console.log(`${name}: ${count} below baseline ${limit}; update frontend-style-baseline.json`);
    }
  }
  if (!process.exitCode) console.log('Frontend style metrics are within baseline.');
}
