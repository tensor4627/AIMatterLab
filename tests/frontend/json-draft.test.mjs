import test from 'node:test';
import assert from 'node:assert/strict';
import {editJsonDraft,inspectJsonDraft,jsonDraftIssue,jsonDraftValueSource} from '../../frontend/ui/json-draft.mjs';
import {makeEnvironmentDraft,readEnvironmentText,writableEnvironment} from '../../frontend/features/cluster/cluster-environment-draft.ts';
import {inspectResumeParameters,parseResumeParameters,replaceResumeParameter} from '../../frontend/features/runs/resume-parameters.mjs';

const initial=makeEnvironmentDraft({executables:{python:'/fixture/python'}});
const cases=[
 ['duplicate',String.raw`{"hidden":[{"key":1,"\u006bey":2}]}`,/重复键/],
 ['number','{"hidden":[9007199254740993]}',/精度/],
 ['number','{"hidden":[1e-999]}',/精度/],
 ['number','{"hidden":[1e999]}',/精度/],
 ['number','{"hidden":[-0.00e2]}',/精度/],
];

test('all three advanced JSON forms detect the same loss, preserve source, and accept corrected text',()=>{
 for(const [issue,source,message] of cases){
  const document=inspectJsonDraft(source);
  assert.equal(jsonDraftIssue(document),issue,source);assert.equal(document.source,source);
  const cluster=readEnvironmentText(initial,source);
  assert.equal(cluster.rawIssue,issue);assert.equal(cluster.text,source);assert.equal(writableEnvironment(cluster),null);
  assert.match(inspectResumeParameters(source).issue,message);
  assert.throws(()=>parseResumeParameters(source,{forSubmission:true}),message);
  const corrected=source.replace(/\[.*\]/,'[0.0100e+2]');
  assert.equal(jsonDraftIssue(inspectJsonDraft(corrected)),null);
  assert.deepEqual(writableEnvironment(readEnvironmentText(cluster,corrected)),{hidden:[1]});
  assert.deepEqual(parseResumeParameters(corrected,{forSubmission:true}),{hidden:[1]});
 }
});

test('shared source updates preserve exact non-target values and allow only opt-in effective duplicate edits',()=>{
 const source=String.raw`{"checkpoint_files":["prior"], "checkpoint_\u0066iles":["active"], "unknown": 9007199254740993}`;
 const document=inspectJsonDraft(source);
 assert.equal(jsonDraftValueSource(document,['checkpoint_files']),'["active"]');
 assert.equal(editJsonDraft(source,['checkpoint_files'],'[]'),source);
 assert.equal(editJsonDraft(source,['checkpoint_files'],undefined,{duplicateKeys:'last'}),source);
 const result=replaceResumeParameter(document,'checkpoint_files',['new']);
 assert.equal(result,source.replace('["active"]','["new"]'));
 assert.deepEqual(parseResumeParameters(result).checkpoint_files,['new']);
 assert.throws(()=>parseResumeParameters(result,{forSubmission:true}),/重复键/);
 assert.throws(()=>parseResumeParameters(result.replace('"checkpoint_files":["prior"], ',''),{forSubmission:true}),/精度/);
});

test('shared inspection keeps array shape and quoted text, handles deeply nested JSON, and checks the sign of zero',()=>{
 const ordinary=inspectJsonDraft(String.raw`{"a":["{\"n\":-0,\"n\":1}",{"n":0.00e-999},{"n":6.02e23}]}`);
 assert.equal(jsonDraftIssue(ordinary),null);
 assert.equal(jsonDraftValueSource(ordinary,['a',1,'n']),'0.00e-999');
 assert.equal(jsonDraftIssue(inspectJsonDraft('[-0]')),'number');
 assert.equal(jsonDraftIssue(inspectJsonDraft('[-0e999999999999999999999999]')),'number');
 const nesting=12000,source='{"payload":'+'['.repeat(nesting)+'0'+']'.repeat(nesting)+'}';
 const deep=inspectJsonDraft(source);assert.equal(jsonDraftIssue(deep),null);assert.equal(deep.root.end,source.length);
});
