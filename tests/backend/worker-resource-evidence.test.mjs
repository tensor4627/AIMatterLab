import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {createTaskStage} from '../../backend/main/workspace/task-stage.mjs';
import {createTaskConsumerStage} from '../../backend/main/workspace/task-consumer-stage.mjs';
import {createTaskConsumerReview} from '../../backend/main/workspace/task-consumer-review.mjs';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {stageFixture as buildFixture} from '../helpers/task-stage-fixture.mjs';
import {stageFixture as consumerFixture} from '../helpers/consumer-stage-fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function resources(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-pack-resources-')),source=path.join(root,'resources','app.asar.unpacked','worker');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const relative of ['studio_worker/engine_contracts.json','studio_worker/tools/derivatives.py','studio_worker/tools/derivative_selection.py']){const target=path.join(source,relative);fs.mkdirSync(path.dirname(target),{recursive:true});const text=fs.readFileSync(new URL('../../backend/worker/'+relative,import.meta.url),'utf8');fs.writeFileSync(target,text+'\n');}return {root,source,hash:relative=>sha(fs.readFileSync(path.join(source,relative)))};}

test('actual stage factories bind source evidence to an explicit packaged worker root',async t=>{
 const r=resources(t),build=buildFixture();build.worker.resourceSource=r.source;
 const stage=createTaskStage({records:build.records,worker:build.worker,current:build.current,assertHuman:()=>true});
 const inspected=await stage.inspect({taskId:'task'},{});assert.equal(inspected.contract.sha256,r.hash('studio_worker/engine_contracts.json'));
 const consumer=consumerFixture();consumer.worker.resourceSource=r.source;
 const api=createTaskConsumerStage({records:consumer.records,worker:consumer.worker,current:consumer.current,assertHuman:()=>true,artifactAccess:consumer.artifactAccess});
 const result=await api.inspect({taskId:'same-task',engine:'gpumd.sampling'},{});assert.equal(result.source.nativeAdapterContract.sha256,r.hash('studio_worker/engine_contracts.json'));
});

test('actual consumer review records derivative implementation hashes from that same packaged source',async t=>{
 const r=resources(t),f=consumerFixture();f.worker.resourceSource=r.source;
 const inspected=await f.api.inspect({taskId:'same-task',engine:'gpumd.sampling'},{}),selected=name=>inspected.assets.find(item=>item.name===name).id;
 const proposed=await f.api.propose({taskId:'same-task',inspectionId:inspected.inspectionId,values:f.values,selections:{potentialId:selected('nep.txt'),historyId:selected('validation-history.txt')}},{});await f.api.save({taskId:'same-task',proposalId:proposed.proposalId},{});
 const request=f.worker.request.bind(f.worker);f.worker.request=async(method,route,data)=>route==='/api/workspace/read'&&data.name===f.asset.path?{path:data.name,size:f.asset.size,sha256:f.asset.sha256,binary:true,text:null}:request(method,route,data);
 f.artifactAccess.deriveCurrentProducer=id=>f.artifactAccess.currentProducer({taskId:id},{});
 const review=createTaskConsumerReview({records:f.records,worker:f.worker,current:f.current,assertHuman:()=>true,artifactAccess:f.artifactAccess,targetReview:()=>null,receiptStore:new Map(),confirm:async()=>false});
 const value=await review.inspect({taskId:'same-task'},{});for(const relative of ['tools/derivatives.py','tools/derivative_selection.py','engine_contracts.json'])assert.equal(value.validationPlan.sourceFiles['backend/worker/studio_worker/'+relative],r.hash('studio_worker/'+relative));
 assert.equal(f.calls.some(call=>/prepare|submit|runtime/.test(call.url)),false);
});

test('an explicit missing or malformed source never silently falls back to checkout resources',t=>{
 const r=resources(t);for(const source of [path.join(r.root,'missing'),'',null])for(const factory of [createTaskStage,createTaskConsumerStage])assert.throws(()=>factory({worker:{resourceSource:source}}),/worker resource|Worker resource/i);
 fs.unlinkSync(path.join(r.source,'studio_worker/engine_contracts.json'));for(const factory of [createTaskStage,createTaskConsumerStage])assert.throws(()=>factory({worker:{resourceSource:r.source}}),/ENOENT|Worker resource/i);
});

test('main binds the real runtime source immutably on the composed client before any connection',()=>{
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true);let initializer;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='worker')initializer=node.initializer?.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(initializer);
 const workerSource=path.resolve('isolated-packaged-layout','resources','app.asar.unpacked','worker'),host={spawnProcess:()=>{throw Error('No process permitted');}};
 const worker=vm.runInNewContext(initializer,{WorkerClient,computeRuntime:host,workerSource});assert.equal(worker.resourceSource,workerSource);assert.equal(Object.getOwnPropertyDescriptor(worker,'resourceSource').writable,false);assert.equal(worker.connection,undefined);worker.close();
});
