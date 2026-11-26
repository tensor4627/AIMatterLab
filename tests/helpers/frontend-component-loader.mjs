import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

export function frontendComponentLoader(overrides = {}, localStorage) {
 const modules = new Map();
 function load(file) {
  const absolute = path.resolve(file);
  if (modules.has(absolute)) return modules.get(absolute).exports;
  const module = {exports: {}};
  modules.set(absolute, module);
  const resolve = name => {
   if (Object.hasOwn(overrides, name)) return overrides[name];
   if (name.endsWith('.css')) return {};
   if (!name.startsWith('.')) return require(name);
   const base = path.resolve(path.dirname(absolute), name);
   const resolved = [base, base + '.ts', base + '.tsx'].find(candidate => fs.existsSync(candidate));
   if (!resolved) throw Error('Unresolved frontend test import ' + name + ' in ' + absolute);
   return load(resolved);
  };
  const source = fs.readFileSync(absolute, 'utf8');
  const compiled = ts.transpileModule(source, {fileName: absolute, compilerOptions: {
   module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  new Function('require', 'module', 'exports', 'localStorage', compiled)(resolve, module, module.exports, localStorage);
  return module.exports;
 }
 return load;
}

export function loadFrontendI18n(localStorage) {
 return frontendComponentLoader({}, localStorage)('frontend/ui/i18n.ts');
}

export function fixtureDisclosure({summary, summaryProps, forceOpen, children, ...props}) {
 return {type:'details',props:{...props,open:forceOpen||props.open,children:[{type:'summary',props:{...summaryProps,children:summary}},children]}};
}

export function fixtureNotice({severity, announce, ...props}) {
 const role=announce===false?undefined:severity==='error'?'alert':'status';
 return {type:'div',props:{role,severity,...props}};
}

// Hook harnesses exercise the feature's state and IPC through its host controls.
// Component tests cover the controls' DOM behavior independently.
export function fixtureControlModule(name) {
 if (/\/Button$/.test(name)) return {default: 'button', Button: 'button'};
 if (/\/Notice$/.test(name)) return {default: 'div'};
 if (/\/Disclosure$/.test(name)) return {default: 'details', Disclosure: 'details'};
 if (/\/ActionBar$/.test(name)) return {default: 'div', ActionBar: 'div'};
 if (/\/States$/.test(name)) return {EmptyState: 'div', LoadingState: 'span', ErrorState: 'div'};
 if (/\/StatusBadge$/.test(name)) {
  return {default: 'span', StatusBadge: 'span', statusLabel: status => status};
 }
}
