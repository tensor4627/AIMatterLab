import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../../frontend/app/App.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let node;function walk(current){if(ts.isFunctionDeclaration(current)&&current.name?.text==='connectSavedLocal')node=current;ts.forEachChild(current,walk);}walk(ast);assert(node);
const compiled=ts.transpileModule('export '+node.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({clearError,connected=true}={}){
 const calls=[],errors=[],module={exports:{}},computeResourceRef={current:{selectionId:'ssh-selection'}};
 const computeResources={status:async()=>({selectionId:'ssh-selection',kind:'ssh-connection'}),clear:async id=>{calls.push(['clear',id]);if(clearError)throw Error('inert conflict');return {selectionId:null,kind:null,status:'none'};}};
 new Function('module','exports','agentBusy','explicitConnection','conversationSelectionSeq','setComputeChooser','computeResources','computeResourceRef','mounted','acceptComputeResource','openComputeGuide','invoke','setSettings','settingsKnown','observeWorker','onError','t',compiled)(module,module.exports,false,{current:null},{current:1},value=>calls.push(['chooser',value]),computeResources,computeResourceRef,{current:true},value=>{computeResourceRef.current=value;calls.push(['resource',value.selectionId]);},async(...args)=>{calls.push(['guide',...args]);return connected;},async method=>{calls.push(['invoke',method]);return {settings:{}};},()=>{}, {current:false},async()=>calls.push(['observe']),error=>errors.push(String(error)),value=>value);
 return {run:()=>module.exports.connectSavedLocal({id:'wsl-profile',version:3}),calls,errors};
}
test('explicit local selection clears SSH routing before opening its connection guide',async()=>{const h=fixture();await h.run();assert.deepEqual(h.calls.filter(value=>['clear','guide'].includes(value[0])),[['clear','ssh-selection'],['guide',undefined,{id:'wsl-profile',version:3}]]);assert.equal(h.errors.length,0);});
test('a refused resource clear cannot start the local connection guide',async()=>{const h=fixture({clearError:true});await h.run();assert.equal(h.calls.some(value=>value[0]==='guide'),false);assert.equal(h.errors.length,1);});
test('cancelling the local guide does not restore or close an existing SSH channel',async()=>{const h=fixture({connected:false});await h.run();assert.equal(h.calls.some(value=>value[0]==='observe'||value[0]==='invoke'),false);assert.deepEqual(h.calls.filter(value=>value[0]==='resource'),[['resource','ssh-selection'],['resource',null]]);});
