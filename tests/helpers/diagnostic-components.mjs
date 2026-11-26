import {frontendComponentLoader,loadFrontendI18n} from './frontend-component-loader.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import * as repair from '../../frontend/features/diagnostics/repair-request.mjs';
import * as diagnostics from "../../frontend/features/diagnostics/ui-diagnostics.mjs";
import * as transcript from '../../contracts/agent/transcript-sanitizer.mjs';

export function diagnosticComponents(){
 const storage=new Map(),localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
 const i18n=loadFrontendI18n(localStorage);
 function load(file,dependencies){
  const component={exports:{}};
  const compiled=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',compiled)(name=>name==='react/jsx-runtime'?jsx:dependencies[name]??{},component,component.exports);
  return component.exports;
 }
 const notice=load('../../frontend/ui/Notice.tsx',{'lucide-react':icons,'./i18n':i18n});
 const component=load('../../frontend/features/diagnostics/DiagnosticNotice.tsx',{'./ui-diagnostics.mjs':diagnostics,'./repair-request.mjs':repair,'../../../contracts/agent/transcript-sanitizer.mjs':transcript,'../../ui/i18n':i18n,'../../ui/Notice':notice,'../../ui/Disclosure':frontendComponentLoader()('frontend/ui/Disclosure.tsx')});
 return {...component,setLanguage:i18n.setLanguage};
}
