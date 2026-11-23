import test from 'node:test';
import assert from 'node:assert/strict';
import {editJsonDraft,inspectJsonDraft,jsonDraftValueSource} from '../../frontend/ui/json-draft.mjs';

test('resource tool argument edits preserve untouched strings, whitespace and argument order',()=>{
 const source=String.raw`[
  "--input={input:seed}",
  "argument with space",
  "line\u000afeed"
 ]`;
 const changed=editJsonDraft(source,[1],JSON.stringify('target "name"'));
 assert.equal(changed,source.replace('"argument with space"','"target \\"name\\""'));
 const appended=editJsonDraft(changed,[3],JSON.stringify(''));
 assert.deepEqual(JSON.parse(appended),['--input={input:seed}','target "name"','line\nfeed','']);
 const removed=editJsonDraft(appended,[0]);
 assert.deepEqual(JSON.parse(removed),['target "name"','line\nfeed','']);
 assert.match(removed,/line\\u000afeed/);
});

test('resource tool leaf edits preserve exact advanced fields and number tokens',()=>{
 const source=String.raw`{
  "inputs": {},
  "outputs": {"result": {"filename":"old.dat","format":"text","future":{"n":9007199254740993}}},
  "parameters": {"low": 0.0100e+2},
  "support_files": ["seed.dat"]
 }`;
 const changed=editJsonDraft(source,['outputs','result','filename'],'"new.dat"');
 assert.equal(changed,source.replace('"old.dat"','"new.dat"'));
 const appended=editJsonDraft(changed,['inputs','seed'],JSON.stringify({filename:'seed.dat',format:'text'}));
 assert.equal(jsonDraftValueSource(inspectJsonDraft(appended),['parameters','low']),'0.0100e+2');
 assert.equal(jsonDraftValueSource(inspectJsonDraft(appended),['outputs','result','future','n']),'9007199254740993');
 assert.deepEqual(JSON.parse(appended).inputs.seed,{filename:'seed.dat',format:'text'});
});

test('resource tool test options insert and remove only the selected fields',()=>{
 const source='{"inputs":{},"max_seconds":120,"outputs":{"result":{"contains":"done"}}}';
 const added=editJsonDraft(source,['resources','gpus'],'0');
 assert.deepEqual(JSON.parse(added),{...JSON.parse(source),resources:{gpus:0}});
 const withFixture=editJsonDraft(added,['inputs','seed'],JSON.stringify({text:'first\nsecond'}));
 assert.deepEqual(JSON.parse(withFixture).inputs.seed,{text:'first\nsecond'});
 assert.equal(jsonDraftValueSource(inspectJsonDraft(withFixture),['outputs','result']), '{"contains":"done"}');
 assert.deepEqual(JSON.parse(editJsonDraft(withFixture,['resources','gpus'])).resources,{});
 assert.deepEqual(JSON.parse(editJsonDraft(withFixture,['inputs','seed'])).inputs,{});
});

test('resource tool edits refuse invalid grammar and duplicate objects without replacing the draft',()=>{
 const broken='{"inputs":';
 assert.equal(inspectJsonDraft(broken),null);
 assert.equal(editJsonDraft(broken,['inputs','seed'],'{}'),broken);
 const duplicate=String.raw`{"outputs":{"result":1,"\u0072esult":2}}`;
 assert.equal(inspectJsonDraft(duplicate).duplicateKeys,true);
 assert.equal(editJsonDraft(duplicate,['outputs','result'],'{}'),duplicate);
 const incompatible='{"inputs":null}';
 assert.equal(editJsonDraft(incompatible,['inputs','seed'],'{}'),incompatible);
});

test('resource tool JSON reports numbers the plan transport would change',()=>{
 for(const raw of ['9007199254740993','1e999','1e-999','-0.0','0.100000000000000000000000000000001']){
  assert.equal(inspectJsonDraft('{"n":'+raw+'}').lossyNumbers,true,raw);
 }
 for(const raw of ['0','9007199254740991','0.0100e+2','6.02e23','0.000015','"1e999"']){
  assert.equal(inspectJsonDraft('{"n":'+raw+'}').lossyNumbers,false,raw);
 }
});
