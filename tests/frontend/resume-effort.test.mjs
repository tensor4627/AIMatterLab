import test from 'node:test';import assert from 'node:assert/strict';import {resumedEffort} from "../../frontend/features/conversations/resume-effort.mjs";

const model={supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'high'};
test('explicit provider low survives a restored server high when supported',()=>assert.equal(resumedEffort({provider:'codex',preferences:{codex:'low'},model,serverEffort:'high'}),'low'));
test('unsupported saved choice falls back only to a supported server choice',()=>assert.equal(resumedEffort({provider:'codex',preferences:{codex:'xhigh'},model,serverEffort:'high'}),'high'));
test('missing saved choice uses supported server effort before model default',()=>assert.equal(resumedEffort({provider:'codex',model,serverEffort:'low'}),'low'));
test('unsupported server effort uses the declared supported model default',()=>assert.equal(resumedEffort({provider:'codex',model,serverEffort:'unsupported'}),'high'));
test('provider preference never leaks from another provider',()=>{assert.equal(resumedEffort({provider:'kimi',preferences:{codex:'low'},model,serverEffort:'high'}),'high');assert.equal(resumedEffort({provider:'deepseek',preferences:{codex:'high',deepseek:'none'},model:{supportedReasoningEfforts:[{reasoningEffort:'none'},{reasoningEffort:'high'}]},serverEffort:'high'}),'none');});
test('missing catalog or unsupported default cannot invent an advertised effort',()=>{assert.equal(resumedEffort({provider:'codex',preferences:{codex:'low'},serverEffort:'high'}),'');assert.equal(resumedEffort({provider:'codex',model:{supportedReasoningEfforts:[],defaultReasoningEffort:'high'},serverEffort:'high'}),'');});
test('selection does not mutate preferences or catalog',()=>{const input={provider:'codex',preferences:{codex:'low'},model,serverEffort:'high'},copy=structuredClone(input);resumedEffort(input);assert.deepEqual(input,copy);});
