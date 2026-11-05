import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {PublicRuleEvidence} from "../../agent/skills/public-rule-evidence.mjs";
const sha=value=>createHash('sha256').update(value).digest('hex');
test('Rule source match is bounded metadata only; changes and missing registrations downgrade defaults to reference',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-rules-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'base'));await fs.writeFile(path.join(root,'base/cv.py'),'# actual source');
 const service=new PublicRuleEvidence(id=>id==='pygas'?root:undefined),document={source_receipt:{local_files:[{source_id:'pygas',path:'base/cv.py',sha256:sha('# actual source')}]}};
 const first=await service.inspect(document);assert.equal(first.status,'source_matched_reference');assert.match(first.scope,/runtime.*not established/);assert.equal(first.files[0].actual_sha256,sha('# actual source'));assert(!JSON.stringify(first).includes(root));
 await fs.writeFile(path.join(root,'base/cv.py'),'# changed implementation');const next=await service.inspect(document);assert.equal(next.status,'reference_only');assert.equal(next.files[0].status,'stale');
 assert.equal((await new PublicRuleEvidence(()=>undefined).inspect(document)).files[0].status,'unregistered');
 await assert.rejects(service.inspect({source_receipt:{local_files:[{source_id:'pygas',path:'../secret',sha256:'0'.repeat(64)}]}}),/Invalid/);
});
