import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyProviderAccess} from '../../desktop/platform/verification/install-verification.mjs';
import {verifyDesktop} from '../../desktop/platform/verification/provider-verification.mjs';

test('one-prompt provider verification reports a missing CLI before account/model/turn requests',async()=>{
 const calls=[],stages=[];
 await assert.rejects(verifyProviderAccess('kimi',async(method,data)=>{calls.push({method,data});return {cliRequired:{provider:'kimi',status:'missing'}};},()=>assert.fail('No model turn is authorized'),stage=>stages.push(stage)),/Selected CLI is not ready/);
 assert.deepEqual(calls,[{method:'agent.connect',data:{provider:'kimi'}}]);
 assert.deepEqual(stages,['provider_connect','provider_cli']);
});

test('optional all-provider check accepts missing bundled CLIs as blocked without downloading',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cli-verifier-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const expressions=[],window={webContents:{executeJavaScript:async code=>{expressions.push(code);return [{provider:'kimi',status:'missing'},{provider:'qwen',status:'incompatible'}];}}};
 assert.equal(await verifyDesktop(window,root,[],{packaged:true,agentPaths:{kimi:'',qwen:''}}),false);
 const report=JSON.parse(fs.readFileSync(path.join(root,'.studio/validation/providers-desktop.json'),'utf8'));
 assert.equal(report.status,'blocked');assert.match(report.reason,/No download was started/);assert.equal(expressions.length,1);assert.match(expressions[0],/agent\.cli\.inspect/);
});
