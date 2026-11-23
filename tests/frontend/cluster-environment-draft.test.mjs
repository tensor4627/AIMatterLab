import test from 'node:test';
import assert from 'node:assert/strict';
import {editEnvironmentRow,makeEnvironmentDraft,readEnvironmentText,writableEnvironment} from '../../frontend/features/cluster/cluster-environment-draft.ts';

const original={executables:{python:'/fixture/python',gpumd:'/fixture/gpumd'},repositories:{pydyn:'/fixture/source'},variables:{OMP_NUM_THREADS:4,LIBRARY_PATH:''},extensions:{release:{channel:'fixture',labels:[null,false,{scope:'owner'}]}}};

test('structured editing preserves unknown environment fields, existing integer values, and intentional empty strings',()=>{
 let draft=makeEnvironmentDraft(original);
 const python=draft.rows.executables[0],threads=draft.rows.variables[0];
 draft=editEnvironmentRow(draft,'executables',{type:'value',id:python.id,text:'/new/python'});
 draft=editEnvironmentRow(draft,'variables',{type:'value',id:threads.id,text:'8'});
 assert.deepEqual(writableEnvironment(draft),{...original,executables:{python:'/new/python',gpumd:'/fixture/gpumd'},variables:{OMP_NUM_THREADS:8,LIBRARY_PATH:''}});
 assert.deepEqual(JSON.parse(draft.text),draft.document);
 assert.equal(original.executables.python,'/fixture/python');
 assert.equal(original.variables.OMP_NUM_THREADS,4);
});

test('an incomplete structured row survives until named and has no valid JSON to overwrite it',()=>{
 const initial=makeEnvironmentDraft({executables:{python:'/fixture/python'}});
 let draft=editEnvironmentRow(initial,'repositories',{type:'add'});
 const row=draft.rows.repositories[0];
 assert.equal(draft.text,initial.text);
 draft=editEnvironmentRow(draft,'repositories',{type:'value',id:row.id,text:'/fixture/new-repository'});
 assert.equal(draft.rowIssue.code,'name');
 assert.equal(writableEnvironment(draft),null);
 assert.equal(readEnvironmentText(draft,initial.text),draft);
 draft=editEnvironmentRow(draft,'repositories',{type:'name',id:row.id,text:'gpumd'});
 assert.deepEqual(writableEnvironment(draft),{executables:{python:'/fixture/python'},repositories:{gpumd:'/fixture/new-repository'}});
});

test('duplicate structured names leave both values editable until the conflict is resolved',()=>{
 let draft=makeEnvironmentDraft(original);
 const gpumd=draft.rows.executables[1];
 draft=editEnvironmentRow(draft,'executables',{type:'name',id:gpumd.id,text:'python'});
 assert.equal(draft.rowIssue.code,'duplicate');
 assert.equal(writableEnvironment(draft),null);
 assert.deepEqual(draft.rows.executables.map(row=>[row.name,row.value.text]),[['python','/fixture/python'],['python','/fixture/gpumd']]);
 draft=editEnvironmentRow(draft,'executables',{type:'name',id:gpumd.id,text:'custom'});
 assert.deepEqual(writableEnvironment(draft).executables,{python:'/fixture/python',custom:'/fixture/gpumd'});
});

test('partial integer editing and an unrecognized saved value preserve their representations',()=>{
 let draft=makeEnvironmentDraft({...original,variables:{...original.variables,OPENBLAS_NUM_THREADS:true}});
 const threads=draft.rows.variables[0];
 draft=editEnvironmentRow(draft,'variables',{type:'value',id:threads.id,text:''});
 assert.equal(draft.rowIssue.code,'integer');
 assert.equal(writableEnvironment(draft),null);
 draft=editEnvironmentRow(draft,'variables',{type:'value',id:threads.id,text:'0'});
 assert.deepEqual(writableEnvironment(draft).variables,{...original.variables,OMP_NUM_THREADS:0,OPENBLAS_NUM_THREADS:true});
});

for(const [text,issue] of [
 ['{"executables":{','syntax'],
 ['[]','object'],
 ['{"executables":{}, "executables":{}}','duplicate'],
 ['{"advanced":[{"x":1,"\\u0078":2}]}','duplicate'],
 ['{"advanced":9007199254740993e0}','number'],
 ['{"advanced":1e999}','number'],
 ['{"advanced":1e-999}','number'],
 ['{"advanced":-0e2}','number'],
])test('raw '+issue+' preserves the exact draft and fences edits to the last valid view',()=>{
 const previous=makeEnvironmentDraft(original);
 const draft=readEnvironmentText(previous,text);
 assert.equal(draft.text,text);
 assert.equal(draft.rawIssue,issue);
 assert.equal(writableEnvironment(draft),null);
 assert.equal(draft.rows,previous.rows);
 assert.equal(editEnvironmentRow(draft,'variables',{type:'add'}),draft);
 assert.deepEqual(writableEnvironment(readEnvironmentText(draft,previous.text)),original);
});

test('advanced JSON allows repeated names in different objects, escaped strings, and representable numbers',()=>{
 const text=String.raw`{ "executables": {"python":"/fixture/python"}, "advanced": [{"x":0.0100e+2},{"x":6.02e23}], "description": "ignore { \"x\":true, \"x\":false }", "__proto__": {"allowed": true} }`;
 let draft=readEnvironmentText(makeEnvironmentDraft(original),text);
 assert.equal(draft.rawIssue,null);
 assert.equal(draft.text,text);
 const next=editEnvironmentRow(draft,'executables',{type:'value',id:draft.rows.executables[0].id,text:'/elsewhere/python'});
 assert.equal(Object.hasOwn(next.document,'__proto__'),true);
 assert.deepEqual(next.document.advanced,[{x:1},{x:6.02e23}]);
 assert.equal(Object.getPrototypeOf(next.document),Object.prototype);
 assert.equal(next.document.description,JSON.parse(text).description);
});

test('editing one legacy group preserves differently shaped advanced sections',()=>{
 let draft=makeEnvironmentDraft({executables:{python:'/fixture/python'},repositories:null,advanced:[true]});
 const updated=editEnvironmentRow(draft,'executables',{type:'value',id:draft.rows.executables[0].id,text:'/updated/python'});
 assert.deepEqual(writableEnvironment(updated),{executables:{python:'/updated/python'},repositories:null,advanced:[true]});
 assert.equal(editEnvironmentRow(updated,'repositories',{type:'add'}),updated);
});

test('a structured integer row retains negative zero text until it is consciously corrected',()=>{
 let draft=makeEnvironmentDraft(original);const id=draft.rows.variables[0].id;
 draft=editEnvironmentRow(draft,'variables',{type:'value',id,text:'-0'});
 assert.equal(draft.rowIssue.code,'integer');assert.equal(draft.rows.variables[0].value.text,'-0');assert.equal(writableEnvironment(draft),null);
 draft=editEnvironmentRow(draft,'variables',{type:'value',id,text:'0'});
 assert.equal(writableEnvironment(draft).variables.OMP_NUM_THREADS,0);
});
