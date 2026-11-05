// Inspect actual production imports; no app, worker, provider or scientific program is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const slash=value=>value.split(path.sep).join('/');
const roots=['frontend','backend/main','agent','contracts','desktop'];
const extensions=['','.mjs','.cjs','.ts','.tsx','.mts','.json','.css','.svg'];
const files=[],edges=[];
function visit(directory){for(const item of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){
 const name=directory+'/'+item.name;if(item.isSymbolicLink())throw Error('Linked production source: '+name);
 if(item.isDirectory())visit(name);else if(/\.(?:mjs|cjs|ts|tsx|mts)$/.test(name))files.push(name);
}}
for(const directory of roots)visit(directory);
for(const file of files){
 const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const record=node=>{if(ts.isStringLiteralLike(node))edges.push({from:file,specifier:node.text});};
 function walk(node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){if(node.moduleSpecifier)record(node.moduleSpecifier);}
  else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){if(node.arguments.length===1)record(node.arguments[0]);}
  ts.forEachChild(node,walk);
 }
 walk(source);
}
function resolved(edge){
 const base=path.resolve(root,path.dirname(edge.from),edge.specifier);
 for(const ending of extensions)if(fs.existsSync(base+ending)&&fs.statSync(base+ending).isFile())return slash(path.relative(root,base+ending));
 for(const ending of extensions.slice(1))if(fs.existsSync(path.join(base,'index'+ending)))return slash(path.relative(root,path.join(base,'index'+ending)));
 return null;
}
const relative=edges.filter(edge=>edge.specifier.startsWith('.')).map(edge=>({...edge,to:resolved(edge)}));
const builtins=new Set(builtinModules.map(value=>value.replace(/^node:/,'')));
const isNode=value=>value.startsWith('node:')||value==='electron'||builtins.has(value);

test('actual production import graph resolves after moving source owners',()=>{
 assert(files.length>100);assert(relative.length>100);
 assert.deepEqual(relative.filter(edge=>!edge.to),[]);
});

test('renderer implementations have no case-insensitive extension resolution collisions',()=>{
 const owners=new Map(),collisions=[];
 for(const file of files.filter(file=>file.startsWith('frontend/')&&!/\.d\.(?:ts|mts)$/.test(file))){
  const key=file.replace(/\.(?:mjs|cjs|ts|tsx|mts)$/,'').toLowerCase();
  if(owners.has(key))collisions.push([owners.get(key),file]);else owners.set(key,file);
 }
 assert.deepEqual(collisions,[],'TypeScript and the production bundler must select the same renderer owner');
});

test('renderer imports stay in frontend and pure contracts without Node or privileged owners',()=>{
 assert.deepEqual(edges.filter(edge=>edge.from.startsWith('frontend/')&&isNode(edge.specifier)),[]);
 assert.deepEqual(relative.filter(edge=>edge.from.startsWith('frontend/')&&edge.to&&/^(?:backend|agent|desktop)\//.test(edge.to)),[]);
 assert.deepEqual(edges.filter(edge=>edge.from.startsWith('contracts/')&&isNode(edge.specifier)),[]);
 assert.deepEqual(relative.filter(edge=>edge.from.startsWith('contracts/')&&edge.to&&/^(?:frontend|backend|agent|desktop)\//.test(edge.to)),[]);
 const pending=files.filter(file=>file.startsWith('frontend/')),seen=new Set(),violations=[];
 while(pending.length){const file=pending.pop();if(seen.has(file))continue;seen.add(file);
  for(const edge of edges.filter(edge=>edge.from===file))if(isNode(edge.specifier))violations.push(edge);
  for(const edge of relative.filter(edge=>edge.from===file&&edge.to)){
   if(/^(?:backend|agent|desktop)\//.test(edge.to))violations.push(edge);else pending.push(edge.to);
  }
 }
 assert.deepEqual(violations,[],'renderer transitive dependencies also remain unprivileged');
});

test('backend and Agent consume desktop platform capabilities without reverse business imports',()=>{
 assert.deepEqual(relative.filter(edge=>edge.from.startsWith('backend/main/')&&edge.to&&/^(?:frontend|agent)\//.test(edge.to)),[]);
 assert.deepEqual(relative.filter(edge=>/^(?:backend\/main|agent)\//.test(edge.from)&&edge.to?.startsWith('desktop/')&&!edge.to.startsWith('desktop/platform/')),[]);
});
