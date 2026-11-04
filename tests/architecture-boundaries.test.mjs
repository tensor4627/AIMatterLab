import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import ts from 'typescript';

const root=fileURLToPath(new URL('..',import.meta.url));
const builtins=new Set(builtinModules.map(name=>name.replace(/^node:/,'')));
function imports(file){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const values=[];
 function visit(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))values.push(node.moduleSpecifier.text);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')&&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))values.push(node.arguments[0].text);
  ts.forEachChild(node,visit);
 }
 visit(ast);return values;
}
function resolveRelative(file,specifier){
 const target=path.resolve(path.dirname(file),specifier.split('?')[0]);
 const found=[target,...['.ts','.tsx','.mjs','.cjs','.js','.json','.d.ts'].map(suffix=>target+suffix),path.join(target,'index.ts')].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
 assert(found,'Unresolved renderer import '+path.relative(root,file)+' -> '+specifier);return found;
}

test('literal renderer source imports contain no Node or privileged domain imports',()=>{
 const queue=[path.join(root,'src/main.tsx')],seen=new Set();
 while(queue.length){
  const file=queue.pop();if(seen.has(file)||! /\.[cm]?[jt]sx?$/.test(file))continue;seen.add(file);
  const relative=path.relative(root,file).replaceAll('\\','/');
  assert(! /^(?:desktop|backend|agent)\//.test(relative),'Renderer imports privileged source: '+relative);
  assert(!relative.startsWith('../'),'Renderer import escaped checkout');
  for(const specifier of imports(file)){
   assert(!specifier.startsWith('node:')&&!builtins.has(specifier)&&specifier!=='electron','Privileged renderer import '+relative+' -> '+specifier);
   if(specifier.startsWith('.'))queue.push(resolveRelative(file,specifier));
  }
 }
 assert(seen.has(path.join(root,'frontend/api/studio.ts')),'The actual renderer must consume the separated IPC client');
 assert(seen.has(path.join(root,'frontend/features/conversations/useConversationSelection.ts')),'The actual App must consume the conversation controller');
});

test('direct workspace and compute imports contain no model context or provider implementations',()=>{
 for(const domain of ['workspace','compute']){
  const directory=path.join(root,'backend/main',domain);
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.mjs'))){
   const file=path.join(directory,name);
   for(const specifier of imports(file)){
    if(!specifier.startsWith('.'))continue;
    const relative=path.relative(root,path.resolve(directory,specifier)).replaceAll('\\','/');
    assert(!relative.startsWith('agent/'),'Backend depends on model-facing modules: '+relative);
    assert(! /^desktop\/(?:agent-settings|agent-hub|codex|acp|deepseek|compatible-api)\.mjs$/.test(relative),'Backend reaches an Agent compatibility facade: '+relative);
   }
  }
 }
});
