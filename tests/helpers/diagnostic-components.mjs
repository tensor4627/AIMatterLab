import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as diagnostics from '../../shared/ui-diagnostics.mjs';
export function diagnosticComponents(){
 const storage=new Map(),localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},module={exports:{}};
 new Function('module','exports','localStorage',ts.transpileModule(fs.readFileSync(new URL('../../src/i18n.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports,localStorage);
 const i18n=module.exports,component={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(new URL('../../src/DiagnosticNotice.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name==='react/jsx-runtime'?jsx:name==='../shared/ui-diagnostics.mjs'?diagnostics:name==='./i18n'?i18n:{},component,component.exports);
 return {...component.exports,setLanguage:i18n.setLanguage};
}
