import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {remember} from "../../backend/main/workspace/bounded-map.mjs";
import _imp_0_fs from "node:fs";
import path from "node:path";
import {clusterDownloadRequest} from "../../contracts/compute/cluster-download.mjs";
import os from "node:os";
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {TaskRecords} from "../../backend/main/workspace/task-records.mjs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {EXISTING_DATA_ROOT_READ, inspectExistingDataRoot} from "../../backend/main/compute/existing-worker.mjs";
import {MaterialsProject, mpQuery, mpRecipe, MP_ENDPOINT} from "../../backend/main/tools/materials-project.mjs";
import {createMonitorAttention} from "../../backend/main/compute/monitor-attention.mjs";
import {withComputeProject} from "../helpers/deployment-worker-fixture.mjs";
import {fixture as _imp_1_fixture, viewed, clone, directory, h} from "../helpers/local-review-fixture.mjs";
import {digest as _imp_2_digest} from "../../backend/main/workspace/review-authority.mjs";
import {saveDeployment, prepareDeployment as prepareActualDeployment} from "../../backend/main/workspace/task-deployment.mjs";
import {publicAddress, publicSoftwareUrl, softwareDocs} from "../../backend/main/tools/public-software-docs.mjs";
import {createRoadmapNotifications} from "../../backend/main/workspace/roadmap-notifications.mjs";
import {sshSourceId} from "../../backend/main/compute/worker-service-version.mjs";
import {serviceHistory} from "../../agent/sessions/wake-delivery.mjs";
import {executeTask} from "../../backend/main/workspace/task-execution.mjs";
import {explicitScientificInputs, ensureTaskAuthoring} from "../../backend/main/workspace/task-authoring.mjs";
import _imp_3_fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {importTaskAsset} from "../../backend/main/workspace/task-asset-import.mjs";
import {readTaskInput} from "../../backend/main/workspace/task-input-preview.mjs";
import {stageFixture, configured, nativeKeys} from "../helpers/task-stage-fixture.mjs";
import {engineContracts} from "../../contracts/tools/engine-contracts.mjs";
import {terminalExecutionCache} from "../../desktop/platform/terminal-execution-cache.mjs";

await __describe("bounded-map", async () => {
const test = __node_test;
test('remember keeps the most recent entries and evicts the oldest',()=>{
 const map=new Map();
 for(const [key,value] of [['a',1],['b',2],['c',3]])remember(map,key,value,{max:2});
 assert.deepEqual([...map.keys()],['b','c']);
 assert.equal(map.get('b'),2);
});

test('re-inserting an existing key refreshes its position',()=>{
 const map=new Map();
 remember(map,'a',1,{max:2});remember(map,'b',2,{max:2});remember(map,'a',3,{max:2});
 assert.deepEqual([...map.keys()],['b','a']);
 assert.equal(map.get('a'),3);
});

test('invalid maps and bounds are rejected',()=>{
 assert.throws(()=>remember({},'a',1),/Map/);
 assert.throws(()=>remember(new Map(),'a',1,{max:0}),/size/);
 assert.throws(()=>remember(new Map(),'a',1,{max:1.5}),/size/);
});
});

await __describe("cluster-download-preview", async () => {
const test = __node_test;
const fs = _imp_0_fs;
const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),start=source.indexOf("handle('cluster.download',async value=>{")+"handle('cluster.download',async value=>{".length,end=source.indexOf('\n});',start);
const compiled=new (Object.getPrototypeOf(async function(){}).constructor)('value','worker','dialog','path','window','clusterDownloadRequest',source.slice(start,end));
const handler=(value,worker,dialog,path)=>compiled({project_id:'project-a',cluster_id:'cluster-a',...value},worker,dialog,path,undefined,clusterDownloadRequest);
test('download refuses a file changed since preview before showing a save dialog',async()=>{let dialogs=0;const worker={request:async()=>({base64:'QQ==',sha256:'b'.repeat(64)})},dialog={showSaveDialog:async()=>{dialogs++;return {canceled:true};}};await assert.rejects(handler({relative:'file.xyz',expected_sha256:'a'.repeat(64)},worker,dialog,path),/远程文件已变化/);assert.equal(dialogs,0);});
test('a matching preview reaches the native dialog and cancellation returns no success receipt',async()=>{let dialogs=0;const sha='a'.repeat(64),worker={request:async()=>({base64:'QQ==',sha256:sha})},dialog={showSaveDialog:async()=>{dialogs++;return {canceled:true};}};assert.equal(await handler({relative:'file.xyz',expected_sha256:sha},worker,dialog,path),null);assert.equal(dialogs,1);});
test('download request validates the optional checksum and preserves older callers without one',()=>{const old={project_id:'project-a',cluster_id:'cluster-a',relative:'file.xyz'};assert.deepEqual(clusterDownloadRequest(old),{...old,root_index:0});for(const patch of [{expected_sha256:42},{expected_sha256:'bad'},{root_index:-1},{root_index:'0'},{relative:'/absolute'},{relative:'a\0b'},{extra:true},{project_id:''}])assert.throws(()=>clusterDownloadRequest({...old,...patch}));});
test('invalid typed download payload is rejected before worker access',async()=>{let calls=0;await assert.rejects(handler({expected_sha256:'bad'},{request:async()=>{calls++;}},null,path),/Invalid preview checksum/);assert.equal(calls,0);});
test('preview checksum remains desktop-owned and the worker receives its unchanged browse contract',async()=>{const sha='a'.repeat(64),calls=[],worker={request:async(...args)=>{calls.push(args);return {base64:'QQ==',sha256:sha};}},dialog={showSaveDialog:async()=>({canceled:true})};await handler({relative:'file.xyz',root_index:1,expected_sha256:sha},worker,dialog,path);assert.deepEqual(calls,[['POST','/api/cluster/browse',{project_id:'project-a',cluster_id:'cluster-a',relative:'file.xyz',root_index:1,offset:0}]]);});
});

await __describe("conversation-groups", async () => {
const test = __node_test;
const fs = _imp_0_fs;
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-group-')),catalog=new Catalog(root),events=[],records=new TaskRecords(catalog,event=>events.push(event));t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});return {root,catalog,events,records};}
test('group deletion persists while preserving conversations, pins, workflows and protected records',t=>{
 const {catalog,records,events}=fixture(t),group=records.createGroup({name:'metad'}),other=records.createGroup({name:'neb'});
 for(const [provider,id]of [['codex','one'],['qwen','two']]){records.remember({provider,threadId:id,groupId:group.id,name:id});records.organize({id:provider+':'+id,pinned:true,groupId:group.id});}
 records.remember({provider:'codex',threadId:'keep',groupId:other.id,name:'keep'});
 for(const kind of ['agent-task','ssh','compute-profile','project','run','settings','credentials'])catalog.put(kind,'protected',{id:'protected',temperature:310,status:'running'});
 const before=catalog.db.prepare('SELECT kind,id,data FROM records WHERE kind != ? AND kind != ?').all('conversation','conversation-project');events.length=0;
 const result=records.deleteGroup({id:group.id});assert.equal(result.conversations.length,2);assert(!records.groups().some(g=>g.id===group.id));
 for(const c of result.conversations){assert.equal(c.groupId,null);assert.equal(c.pinned,true);assert.equal(records.conversation(c.provider,c.threadId).id,c.id);}
 assert.equal(records.conversation('codex','keep').groupId,other.id);
 for(const record of before)assert.equal(catalog.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(record.kind,record.id).data,record.data);
 assert.equal(new TaskRecords(catalog,()=>{}).conversations().length,3);assert.equal(events.filter(e=>e.method==='studio/conversationGroupDeleted').length,1);
 assert.deepEqual(records.deleteGroup({id:group.id}),{id:group.id,conversations:[]});
});
test('group deletion rolls back reassignment and group removal on a write failure',t=>{
 const {catalog,records,events}=fixture(t),group=records.createGroup({name:'rollback'});records.remember({provider:'codex',threadId:'one',groupId:group.id,name:'one'});events.length=0;
 const put=catalog.put.bind(catalog);catalog.put=(kind,...args)=>{if(kind==='deleted-conversation-project')throw Error('Synthetic disk failure');return put(kind,...args);};
 assert.throws(()=>records.deleteGroup({id:group.id}),/disk failure/);assert.equal(records.conversation('codex','one').groupId,group.id);assert(records.groups().some(g=>g.id===group.id));assert.deepEqual(events,[]);
});
test('late remember cannot restore a deleted group, and explicit stale organization is refused',t=>{
 const {records}=fixture(t),group=records.createGroup({name:'old'});records.remember({provider:'codex',threadId:'existing',groupId:group.id,name:'existing'});records.deleteGroup({id:group.id});
 for(const threadId of ['existing','late'])assert.equal(records.remember({provider:'codex',threadId,groupId:group.id,name:threadId}).groupId,null);
 assert.throws(()=>records.organize({id:'codex:existing',pinned:false,groupId:group.id}),/Unknown conversation project/);
 assert.throws(()=>records.remember({provider:'codex',threadId:'foreign',groupId:'never-existed',name:'foreign'}),/Unknown conversation project/);
});
test('delete-group input validation and unknown IDs never mutate the catalog',t=>{
 const {catalog,records}=fixture(t),before=catalog.db.prepare('SELECT * FROM records').all();
 for(const value of [null,{},[],{id:1},{id:''},{id:'x',deleteConversations:true},{id:'x'.repeat(201)},{id:'unknown'}])assert.throws(()=>records.deleteGroup(value));
 assert.deepEqual(catalog.db.prepare('SELECT * FROM records').all(),before);
});
});

await __describe("existing-data-root", async () => {
const test = __node_test;
const exec=promisify(execFile),python=process.env.STUDIO_TEST_PYTHON||'python';
const setup=String.raw`import tempfile,sqlite3,sys,os,json
from pathlib import Path
from unittest.mock import patch
with tempfile.TemporaryDirectory() as temporary:
 root=Path(temporary).resolve();db=root/'worker.sqlite';mode=sys.argv[1];schemaMode=sys.argv[2]
 if mode!='missing':
  fixtureDb=sqlite3.connect(db)
  if mode in ('valid-wal','wal-only'):fixtureDb.execute('PRAGMA journal_mode=WAL')
  if mode!='wrong':fixtureDb.executescript('CREATE TABLE objects(kind TEXT,id TEXT,data TEXT); CREATE TABLE runs(id TEXT,project TEXT,key TEXT,request_hash TEXT,data TEXT);')
  else:fixtureDb.execute('CREATE TABLE unrelated(value TEXT)')
  fixtureDb.commit()
  if mode!='wal-only':fixtureDb.close()
 before={p.name:p.read_bytes() for p in root.iterdir()}
 sys.argv=['proof',str(root),schemaMode]
 if not hasattr(os,'getuid'):os.getuid=lambda:root.stat().st_uid
 original=Path.is_symlink
 with patch.object(Path,'is_symlink',lambda p:True if mode=='symlink' and p==db else original(p)):
  exec(PAYLOAD)
 after={p.name:p.read_bytes() for p in root.iterdir()}
 assert before==after,'Existing-root inspection wrote data'
 if mode=='wal-only':fixtureDb.close()
`;
for(const mode of ['valid','valid-wal','wal-only','missing','wrong','symlink'])test('exact existing database preflight is read-only: '+mode,async()=>{
 const {stdout}=await exec(python,['-B','-c','PAYLOAD='+JSON.stringify(EXISTING_DATA_ROOT_READ)+'\n'+setup,mode,'schema'],{windowsHide:true,timeout:6000,maxBuffer:8192});assert.equal(JSON.parse(stdout.trim()).status,mode.startsWith('valid')?'available':'unavailable');
});
test('existing database check uses exact argv and sanitizes errors',async()=>{
 let call;const settings={distribution:'Ubuntu',workerRoot:'/owned/existing'};assert.deepEqual(await inspectExistingDataRoot(settings,{execute:async(...args)=>{call=args;return {stdout:'{"status":"available"}'};}}),{status:'available'});assert.equal(call[0],'wsl.exe');assert.deepEqual(call[1].slice(0,6),['-d','Ubuntu','--','python3','-B','-c']);assert.equal(call[1].at(-2),settings.workerRoot);assert.equal(call[2].timeout,6000);assert.deepEqual(await inspectExistingDataRoot(settings,{execute:async()=>{throw Error('private-path-token');}}),{status:'unavailable'});
});

test('WAL-only schema still permits basic path proof for verified live attachment without writing sidecars',async()=>{
 const {stdout}=await exec(python,['-B','-c','PAYLOAD='+JSON.stringify(EXISTING_DATA_ROOT_READ)+'\n'+setup,'wal-only','path'],{windowsHide:true,timeout:6000,maxBuffer:8192});assert.equal(JSON.parse(stdout.trim()).status,'available');
});
});

await __describe("materials-project", async () => {
const test = __node_test;
const fs = _imp_0_fs;
const fixture=()=>({material_id:'mp-149',formula_pretty:'Si',nsites:2,structure:{lattice:{matrix:[[5,0,0],[0,5,0],[0,0,5]]},sites:[{species:[{element:'Si',occu:1}],abc:[0,0,0]},{species:[{element:'Si',occu:1}],abc:[.25,.25,.25]}]}});
function client(options={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-mp-'));const worker=options.worker?{connection:{},connectionEpoch:0,...options.worker}:undefined;const m=new MaterialsProject({root,encryption:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v.split('').reverse().join('')),decryptString:v=>v.toString().split('').reverse().join('')},...options,worker});return {m,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}
test('MP query pins endpoint and bounds fields/results; invalid arbitrary URLs fail',()=>{const u=mpQuery('Li3PS4');assert.equal(u.origin,'https://api.materialsproject.org');assert.equal(u.searchParams.get('formula'),'Li3PS4');assert.equal(u.searchParams.get('_limit'),'10');assert.equal(mpQuery('mp-149',true).searchParams.get('material_ids'),'mp-149');assert.throws(()=>mpQuery('https://elsewhere/key'));});
test('MP fractional structure converts without changing site order; disordered sites reject',()=>{const doc=fixture();const r=mpRecipe(doc);assert.deepEqual(r.positions,[[0,0,0],[1.25,1.25,1.25]]);assert.deepEqual(r.symbols,['Si','Si']);doc.structure.sites[0].species[0].occu=.5;assert.throws(()=>mpRecipe(doc),/partially occupied/);});
test('MP key stored through encryption, not returned in status or search',async()=>{const seen=[];const f=client({fetchApi:async(url,options)=>{seen.push({url,options});return new Response(JSON.stringify({data:[fixture()]}));}});try{const key='fixtureMaterialKey0123456789';assert(!JSON.stringify(f.m.save(key)).includes(key));assert(!fs.readFileSync(f.m.file).toString().includes(key));const out=await f.m.search('Si');assert.equal(seen[0].options.headers['X-API-KEY'],key);assert.equal(seen[0].options.redirect,'error');assert.equal(out.documents[0].material_id,'mp-149');assert(!('structure' in out.documents[0]));assert(!JSON.stringify(out).includes(key));f.m.clear();assert(!fs.existsSync(f.m.file));}finally{f.cleanup();}});
test('MP import uses exact returned ID, passes provenance and never the key to worker',async()=>{const calls=[];const f=client({fetchApi:async()=>new Response(JSON.stringify({data:[fixture()],meta:{db_version:'fixture'}})),worker:{request:async(...a)=>{calls.push(a);return {path:'fixture.xyz'};}}});try{f.m.save('fixtureMaterialKey0123456789');await f.m.import({project_id:'p',environment_id:'e',material_id:'mp-149'});assert.equal(calls[0][1],'/api/structures/import-material');assert.equal(calls[0][2].external_provenance.material_id,'mp-149');assert.equal(calls[0][2].external_provenance.response_sha256.length,64);assert(!JSON.stringify(calls).includes('fixtureMaterialKey'));await assert.rejects(()=>f.m.import({project_id:'p',environment_id:'e',material_id:'mp-999'}),/Exact MP/);}finally{f.cleanup();}});
test('MP server failures do not echo response bodies or key',async()=>{const f=client({fetchApi:async()=>new Response('secret response',{status:401})});try{f.m.save('fixtureMaterialKey0123456789');await assert.rejects(()=>f.m.search('Si'),e=>e.message==='Materials Project returned HTTP 401');}finally{f.cleanup();}});
test('MP real access is blocked without credentials and no request is sent',async()=>{let calls=0;const f=client({fetchApi:()=>{calls++;throw Error('unexpected');}});const old=[process.env.MP_API_KEY,process.env.PMG_MAPI_KEY];delete process.env.MP_API_KEY;delete process.env.PMG_MAPI_KEY;try{await assert.rejects(()=>f.m.search('Si'),/configure its API key/);assert.equal(calls,0);}finally{for(const [i,k] of ['MP_API_KEY','PMG_MAPI_KEY'].entries())if(old[i]!==undefined)process.env[k]=old[i];f.cleanup();}});

test('MP IDs accept numeric, short and padded lowercase alpha without forcing legacy response format',()=>{for(const id of ['mp-149','mp-ft','mp-aaaaaaft','mp-'+ 'a'.repeat(70)+'ft']){const u=mpQuery(id,true);assert.equal(u.searchParams.get('material_ids'),id);assert.equal(u.searchParams.has('id_format'),false);}for(const id of ['mp-f1','mp-FT','mp-é','mp-ft/other','mp-','mp-'+ 'a'.repeat(78)])assert.throws(()=>mpQuery(id));});
test('MP numeric and alpha equivalent identities import while preserving actual returned and requested IDs',async()=>{for(const [requested,returned] of [['mp-149','mp-aaaaaaft'],['mp-ft','mp-149'],['mp-aaaaaaft','mp-ft'],['mp-9007199254740993','mp-'+alpha(9007199254740993n)]]){const calls=[],f=client({fetchApi:async()=>new Response(JSON.stringify({data:[{...fixture(),material_id:returned}]})),worker:{request:async(...args)=>{calls.push(args);return {};}}});try{f.m.save('fixtureMaterialKey0123456789');await f.m.import({project_id:'p',environment_id:'e',material_id:requested});const proof=calls[0][2].external_provenance;assert.equal(proof.material_id,returned);assert.equal(proof.requested_material_id,requested);}finally{f.cleanup();}}});
function alpha(value){let out='';do{out=String.fromCharCode(97+Number(value%26n))+out;value/=26n;}while(value);return out;}
test('different or malformed returned material identity and invalid requested ID never reach worker',async()=>{let workers=0,fetches=0;for(const returned of ['mp-fu','mp-150','mp-f1','mp-FT',null]){const f=client({fetchApi:async()=>{fetches++;return new Response(JSON.stringify({data:[{...fixture(),material_id:returned}]}));},worker:{request:async()=>{workers++;}}});try{f.m.save('fixtureMaterialKey0123456789');await assert.rejects(()=>f.m.import({project_id:'p',environment_id:'e',material_id:'mp-149'}),/Exact MP/);const before=fetches;for(const invalid of ['mp-f1','mp-FT','mp-ft/other','mp-é','mp-'+ 'a'.repeat(78)])await assert.rejects(()=>f.m.import({project_id:'p',environment_id:'e',material_id:invalid}),/Select a Materials/);assert.equal(fetches,before);}finally{f.cleanup();}}assert.equal(workers,0);});
});

await __describe("monitor-attention", async () => {
const test = __node_test;
function fixture() {
  const data=new Map(),announcements=[];
  const catalog={get:(_k,id)=>data.get(id),put:(_k,id,value)=>data.set(id,value),list:()=>[...data.values()]};
  const open=()=>createMonitorAttention({catalog,now:()=>500,announce:record=>announcements.push(record)});
  const scope={projectId:'p',provider:'codex',threadId:'t',runId:'run-1'};
  const plan={id:'poll-1',kind:'poll',scope,status:'exhausted',count:48,maxRuns:48,active:null};
  const run={projectId:'p',id:'run-1',status:'running',jobId:'123',observedAt:490};
  const source={id:'original',profileId:'cluster-a',connected:true,schedules:[plan],runs:[run]};
  return {open,source,plan,run,announcements};
}
test('alert follows the final original job receipt once, survives restart and never reopens when acknowledged',()=>{
 const f=fixture(),notices=f.open();
 f.plan.status='running';f.plan.active={id:'last'};notices.reconcile([f.source]);assert.equal(notices.list().length,0);
 f.plan.status='exhausted';f.plan.active=null;notices.reconcile([f.source]);notices.reconcile([f.source]);
 const [notice]=notices.list();assert.equal(notice.jobId,'123');assert.equal(notice.observedAt,490);assert.equal(f.announcements.length,1);
 const reopened=f.open();reopened.reconcile([f.source]);assert.equal(f.announcements.length,1);
 reopened.acknowledge(notice.id);assert.equal(reopened.list()[0].acknowledgedAt,500);
 f.run.status='succeeded';reopened.reconcile([f.source]);assert.deepEqual(reopened.list(),[]);
 f.run.status='unknown';reopened.reconcile([f.source]);assert.deepEqual(reopened.list(),[]);assert.equal(f.announcements.length,1);
});
test('completion including scheduler terminal, stop, expiry, unrelated scripts and an offline replay trigger no exhaustion notification',()=>{
 for(const change of [
   f=>{f.run.status='failed';}, f=>{f.run.status='unknown';f.run.schedulerTerminal=true;},
   f=>{f.plan.status='expired';},f=>{f.plan.status='stopped';},f=>{f.plan.stopRequestedAt=40;},
   f=>{f.plan.kind='script';},f=>{f.plan.kind='wake_agent';},f=>{f.source.connected=false;}
 ]){const f=fixture();change(f);f.open().reconcile([f.source]);assert.equal(f.announcements.length,0);}
});
test('source and project determine the run; unknown gets its own follow-up and shared budget is distinguished',()=>{
 const f=fixture(),n=f.open();f.run.projectId='other';f.plan.count=3;f.plan.delegationCount=336;
 n.reconcile([f.source,{...f.source,id:'other',schedules:[],runs:[{...f.run,projectId:'p',status:'succeeded'}]}]);
 const [notice]=n.list();assert.equal(notice.status,'unknown');assert.equal(notice.jobId,null);assert.equal(notice.delegationExhausted,true);
});
});

await __describe("private-adoption", async () => {
const test = __node_test;
const fs = _imp_0_fs;
const fixture = _imp_1_fixture;
const digest = _imp_2_digest;
const generated=JSON.parse(fs.readFileSync(new URL("../fixtures/generated-private-fixture.json",import.meta.url)));
function privateFixture(){const f=fixture(),module='studio_custom_'+generated.code_sha256+'.py',graph=f.pair.graph;
 const binding={id:'owned-private-entry',spec_sha256:generated.spec_sha256,code_sha256:generated.code_sha256,parameters_sha256:generated.parameters_sha256,revision:'c'.repeat(32),reference_structure_sha256:digest(f.files.get(directory+'/model.xyz')),numerical_receipt_sha256:h,module_name:module.slice(0,-3),module_file:module,class_name:generated.class_name,output_size:1};
 graph.metadata={studio_custom_cvs:[binding]};graph.nodes=[{id:'custom_owned',kind:'cv',class_name:generated.class_name,params:generated.values}];
 f.pair.catalog.custom_cv_bindings=[clone(binding)];f.pair.catalog.source.files[module]=generated.code_sha256;f.files.set(directory+'/'+module,generated.source);
 const graphText=JSON.stringify(graph,null,2)+'\n',old=f.files.get(directory+'/build_bias.py'),line=old.indexOf('\n'),header=JSON.parse(old.slice('# studio-pygas-source: '.length,line)),body='from '+binding.module_name+' import '+binding.class_name+'\n'+old.slice(line+1);
 header.catalog_files=clone(f.pair.catalog.source.files);header.composition={...header.composition,graph_sha256:digest(graphText),body_sha256:digest(body),inputs:{...header.composition.inputs,[module]:generated.code_sha256}};
 const source='# studio-pygas-source: '+JSON.stringify(header)+'\n'+body;f.files.set(directory+'/workflow.json',graphText);f.files.set(directory+'/build_bias.py',source);
 f.pair.composition={...f.pair.composition,graph_sha256:digest(graphText),source_sha256:digest(source),expected:{journal_sha256:h,files:{'workflow.json':digest(graphText),'build_bias.py':digest(source)}}};
 f.mutate(t=>{t.parameters.files.push(directory+'/'+module);t.customCv={id:binding.id,specSha:binding.spec_sha256,codeSha:binding.code_sha256,parametersSha:binding.parameters_sha256,revision:binding.revision,sharing:{codex:false}};t.composition=clone(f.pair.composition);});
 return {f,binding,module};}
const config={target:'local',projectId:'compute',targetId:'env',inputSource:'local',maxSeconds:60,directoryName:'human-private',resources:{cpus:1,gpus:0,memory_mb:512,queue:'',account:''},gpu:0};
async function adoptFixture(){const {f,binding,module}=privateFixture(),seen=[],adopted=new Map();const orig=f.worker.request.bind(f.worker);
 f.worker.request=async(method,target,args)=>{
  if(target==='/api/run/environment-identity')return {kind:'immutable-run-environment-identity-v1',run_id:args.run_id,project_id:'compute',environment_id:'env',engine:'pygas.build',configuration_sha256:f.runtime.facts.configuration_sha256,interpreter:f.environment.executables.python};
  if(target==='/api/authoring/adopt'){seen.push(target);assert.equal(args.source_project_id,'authoring');assert.equal(args.target_project_id,'compute');const paths={};for(const source of args.paths){const text=f.files.get(source),name=source.split('/').at(-1),dest='/worker/projects/compute/inputs/adopt-'+digest(text).slice(0,24)+'/'+name;paths[source]=dest;adopted.set(dest,text);}return {paths};}
  if(target==='/api/runs/prepare'){seen.push(target);return {...clone(args.spec),id:'private-build',status:'draft',validation:{status:'not_run'},identity:null,environment_snapshot:clone(f.environment),snapshots:Object.entries(args.spec.inputs).map(([name,source])=>({name,source,sha256:digest(adopted.get(source)),size:Buffer.byteLength(adopted.get(source))})),private_cv_versions:[{entry_id:binding.id,spec_sha256:binding.spec_sha256,code_sha256:binding.code_sha256,parameters_sha256:binding.parameters_sha256}]};}
  if(target==='/api/workspace/read'&&args.project_id==='compute'){const text=adopted.get(args.name);return {path:args.name,sha256:digest(text),size:Buffer.byteLength(text),binary:false,truncated:false,text,offset:Buffer.byteLength(text)};}
  return orig(method,target,args);
 };
 const v=await viewed(f);await f.service.confirm({taskId:'task',snapshotId:v.snapshotId},{});saveDeployment(f.records,{taskId:'task',value:config},f.service);
 return {f,binding,module,seen,adopted,prepare:()=>prepareDeployment(f.records,f.worker,{taskId:'task'},f.service)};}
test('Real deterministic generator source is included as an exact private closure with sharing OFF',async()=>{const {f,binding}=privateFixture(),v=await viewed(f);assert.equal(v.entries.length,4);const module=v.entries.find(e=>e.role==='approved-private-module');assert.equal(module.sha256,binding.code_sha256);await f.service.confirm({taskId:'task',snapshotId:v.snapshotId},{});assert.equal(f.task().customCv.sharing.codex,false);assert.equal(f.task().review.status,'not_run');});
test('Realistic content-addressed adoption preserves names/roles/current private version and immutable full readback',async()=>{const {f,prepare,seen}=await adoptFixture(),run=await prepare();assert.equal(run.project_id,'compute');assert.deepEqual(seen,['/api/authoring/adopt','/api/runs/prepare']);assert.equal(f.task().deployment.prepared.localInputLineage.length,4);for(const row of f.task().deployment.prepared.localInputLineage){assert.ok(row.sourcePath.startsWith(directory+'/'));assert.ok(row.adoptedPath.includes('/projects/compute/inputs/adopt-'+row.sha256.slice(0,24)+'/'));assert.ok(row.role);}assert.equal(f.task().customCv.sharing.codex,false);});
for(const kind of ['sha','size','path','bytes','truncated'])test('Adopted '+kind+' mismatch cannot authorize the run',async()=>{const {f,prepare}=await adoptFixture(),original=f.worker.request.bind(f.worker);f.worker.request=async(method,target,args)=>{const v=await original(method,target,args);if(target==='/api/workspace/read'&&args.project_id==='compute'){if(kind==='sha')v.sha256='e'.repeat(64);if(kind==='size')v.size++;if(kind==='path')v.path='/other';if(kind==='bytes')v.text+='unexpected';if(kind==='truncated')v.truncated=true;}return v;};await assert.rejects(prepare(),/adopted copy differs/);assert.equal(f.task().deployment.prepared,undefined);});
for(const kind of ['old-code','other-entry','extra-entry','unknown-version'])test('Run private lineage '+kind+' cannot inherit current local approval',async()=>{const {f,prepare}=await adoptFixture(),original=f.worker.request.bind(f.worker);f.worker.request=async(method,target,args)=>{const v=await original(method,target,args);if(target==='/api/runs/prepare'){if(kind==='old-code')v.private_cv_versions[0].code_sha256='0'.repeat(64);if(kind==='other-entry')v.private_cv_versions[0].entry_id='foreign';if(kind==='extra-entry')v.private_cv_versions.push({entry_id:'other'});if(kind==='unknown-version')v.private_cv_versions=[{entry_id:'owned-private-entry',version_status:'unknown'}];}return v;};await assert.rejects(prepare(),/private version lineage/);});
test('Changed private module bytes cannot be approved merely because metadata matches',async()=>{const {f,module}=privateFixture();f.files.set(directory+'/'+module,generated.source+'\n# changed');await assert.rejects(f.service.inspect({taskId:'task'},{}),/structure\/reference\/module changed/);});

function prepareDeployment(records,worker,args,localReview){return prepareActualDeployment(records,withComputeProject(worker,records.read(args.taskId)),args,localReview);}
});

await __describe("public-software-docs", async () => {
const test = __node_test;
test('public software search keeps repository and package evidence separate, including unavailable sources',async()=>{
 const routes=[];
 const result=await softwareDocs('search_software_docs',{software:'example',version:'2.0',sources:'public'},async target=>{
  const url=new URL(target);routes.push(url);
  if(url.hostname==='pypi.org')throw Error('Package not found');
  return {text:JSON.stringify({items:[{full_name:'author/example',html_url:'https://github.com/author/example'}]})};
 });
 assert.equal(result.results[0].name,'author/example');
 assert.equal(result.sources[1].status,'unavailable');
 assert.equal(routes[0].searchParams.get('q'),'example in:name');
 assert.equal(routes[1].pathname,'/pypi/example/2.0/json');
});

test('remote manuals keep the final source and readable contents; internal and credential URLs stay local',async()=>{
 for(const addr of ['127.0.0.1','10.1.2.3','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','2002::1','192.168.1.1'])
  assert.equal(publicAddress(addr),false);
 assert.equal(publicAddress('1.1.1.1'),true);
 for(const url of ['file:///test','https://192.168.0.1/','https://example.local/','https://user:password@example.org','https://[::1]/'])
  assert.throws(()=>publicSoftwareUrl(url));
 const r=await softwareDocs('read_software_docs',{url:'https://example.org/doc'},async()=>({
  url:'https://docs.example.org/v2',type:'text/html',text:'<script>secret()</script><p>Use the release binary.</p>'}));
 assert.deepEqual(r,{source:'https://docs.example.org/v2',text:'Use the release binary.',truncated:false});
});
});

await __describe("roadmap-notifications", async () => {
const test = __node_test;
test('terminal receipt is delivered once to the original conversation and survives desktop restart',async()=>{
 const rows=new Map(),events=[],calls=[];
 const catalog={get:(ns,id)=>rows.get(ns)?.get(id),list:ns=>[...(rows.get(ns)?.values()||[])],put(ns,id,row){if(!rows.has(ns))rows.set(ns,new Map());rows.get(ns).set(id,row);}};
 const binding={kind:'ssh',version:2,profileId:'original',profileVersion:1,root:'/service',hostIdentity:{hostname:'fixture',uid:1,machineId:'test-id'},runtime:'/service/previous',runtimeId:'previous'};
 catalog.put('roadmap-execution-index','run',{id:'run',task_id:'task',worker_binding:binding,snapshot_sha256:'digest'});
 const task={id:'task',provider:'codex',threadId:'chat',name:'Density'};catalog.put('agent-task',task.id,task);
 const row={id:'run',task_id:'task',status:'failed',snapshot_sha256:'digest',nodes:{density:{status:'failed'}},goals:[]};
 const updated={...binding,runtime:'/service/updated',runtimeId:'updated'};
 const source={kind:'ssh',profileId:'original',id:sshSourceId(updated),binding:updated,health:{root:'/service',hostIdentity:binding.hostIdentity,roadmap_execution_schema:1},
  request:async(...args)=>{calls.push(args);return row;}};
 let available=[{...source,binding:{...updated,profileId:'another'}},{...source,binding:{...updated,profileVersion:2}}];
 const create=()=>createRoadmapNotifications({catalog,sources:()=>available,emit:e=>events.push(e)});
 await create().sweep();assert.equal(calls.length,0);
 available=[source];await create().sweep();await create().sweep();
 assert.equal(calls.length,1);assert.equal(events.length,1);assert.equal(events[0].params.threadId,'chat');
 assert.match(serviceHistory(catalog,'codex','chat')[0].items[0].text,/density/);
 assert.deepEqual(serviceHistory(catalog,'codex','different'),[]);
});
});

await __describe("runtime-snapshot", async () => {
const test = __node_test;
const fixture = _imp_1_fixture;
async function ready(){const f=fixture(),preview=await viewed(f);await f.service.confirm({taskId:'task',snapshotId:preview.snapshotId},{});const {data}=await f.service.verify('task'),config={target:'local',targetId:'env',projectId:'authoring',inputSource:'local',maxSeconds:60,directoryName:'runtime-check',resources:{cpus:1,gpus:0,memory_mb:512,queue:'',account:''},gpu:0},run={id:'run',engine:data.engine,project_id:'authoring',environment_id:'env',environment_snapshot:clone(f.environment),status:'draft',validation:{status:'not_run'},parameters:data.spec.parameters,inputs:data.spec.inputs,snapshots:data.entries.map(e=>({name:e.name,source:e.path,size:e.size,sha256:e.sha256})),private_cv_versions:[]};return {f,data,config,run};}
test('Worker-authoritative complete immutable A identity passes only with full current owned run context',async()=>{const {f,data,config,run}=await ready();const v=await f.service.verifyPrepared('task',run,config,data.spec.inputs);assert.equal(v.authority.kind,'local-human');const calls=f.calls.filter(c=>c.target==='/api/run/environment-identity');assert.equal(calls.length,1);assert.deepEqual(calls[0].args,{run_id:'run'});});
for(const mode of ['python','repository','variables','float-lexeme','extra-field','missing-fingerprint','run-id','project','environment','engine','interpreter','kind'])test('Immutable worker identity '+mode+' cannot inherit A receipt even while current registration returns to A',async()=>{const {f,data,config,run}=await ready(),original=f.worker.request.bind(f.worker);f.worker.request=async(method,target,args)=>{const v=await original(method,target,args);if(target==='/api/run/environment-identity'){if(['python','repository','variables','float-lexeme','extra-field'].includes(mode))v.configuration_sha256='b'.repeat(64);if(mode==='missing-fingerprint')delete v.configuration_sha256;if(mode==='run-id')v.run_id='other';if(mode==='project')v.project_id='foreign';if(mode==='environment')v.environment_id='other';if(mode==='engine')v.engine='gpumd.md';if(mode==='interpreter')v.interpreter='/different/python';if(mode==='kind')v.kind='assumed';}return v;};for(const execution of [false,true])await assert.rejects(f.service.verifyPrepared('task',run,config,data.spec.inputs,execution),/worker-authoritative/);});
for(const mode of ['missing','only-id','wrong-python'])test('Missing or unknown returned run snapshot '+mode+' stays blocked',async()=>{const {f,data,config,run}=await ready();if(mode==='missing')delete run.environment_snapshot;if(mode==='only-id')run.environment_snapshot={id:'env'};if(mode==='wrong-python')run.environment_snapshot.executables.python='/other';await assert.rejects(f.service.verifyPrepared('task',run,config,data.spec.inputs),/snapshot|runtime/);});
for(const change of ['selection','revision','disconnect'])test('Final authoritative await '+change+' cannot release prepared authority',async()=>{const {f,data,config,run}=await ready();f.hooks['/api/run/environment-identity']=()=>{if(change==='selection')f.switch();if(change==='revision')f.mutate(t=>t.parameterRevision++);if(change==='disconnect')f.worker.connection=null;};await assert.rejects(f.service.verifyPrepared('task',run,config,data.spec.inputs),/changed|Connect/);});
test('Actual copied prepare rejects B immutable fingerprint before promotion',async()=>{const {f,config,run}=await ready(),original=f.worker.request.bind(f.worker);saveDeployment(f.records,{taskId:'task',value:config},f.service);f.worker.request=async(method,target,args)=>{if(target==='/api/runs/prepare')return clone(run);const v=await original(method,target,args);if(target==='/api/run/environment-identity')v.configuration_sha256='b'.repeat(64);return v;};await assert.rejects(prepareDeployment(f.records,f.worker,{taskId:'task'},f.service),/worker-authoritative/);assert.equal(f.task().deployment.prepared,undefined);});
test('Actual copied execute rejects later B identity before validation or submit',async()=>{const {f,config,run}=await ready(),original=f.worker.request.bind(f.worker);saveDeployment(f.records,{taskId:'task',value:config},f.service);let changed=false;const calls=[];f.worker.request=async(method,target,args)=>{calls.push(target);if(target==='/api/runs/prepare'||target==='/api/run/status')return clone(run);const v=await original(method,target,args);if(target==='/api/run/environment-identity'&&changed)v.configuration_sha256='b'.repeat(64);return v;};await prepareDeployment(f.records,f.worker,{taskId:'task'},f.service);changed=true;await assert.rejects(executeTask(f.records,f.worker,{runChecks:true,taskId:'task',artifactId:run.id,inputReceipt:f.task().deployment.prepared.inputIdentity},f.service),/worker-authoritative/);assert.equal(calls.includes('/api/run/validate'),false);assert.equal(calls.includes('/api/run/submit'),false);});

test('Configured invocation alias may differ from observed sys.executable when the actual guide registration_match passed',async()=>{const f=fixture();f.runtime.facts.python.executable='/registered/real/python3';f.runtime.facts.executables.python=f.environment.executables.python;const view=await viewed(f);await f.service.confirm({taskId:'task',snapshotId:view.snapshotId},{});const {data}=await f.service.verify('task');assert.equal(data.runtimeInterpreter,'/registered/real/python3');assert.equal(data.runtimeConfiguredInvocation,'/registered/python');const run={id:'alias-run',engine:data.engine,project_id:'authoring',environment_id:'env',environment_snapshot:clone(f.environment),status:'draft',validation:{status:'not_run'},parameters:data.spec.parameters,inputs:data.spec.inputs,snapshots:data.entries.map(e=>({name:e.name,source:e.path,size:e.size,sha256:e.sha256})),private_cv_versions:[]};const result=await f.service.verifyPrepared('task',run,{target:'local',targetId:'env',projectId:'authoring',inputSource:'local'},data.spec.inputs);assert.equal(result.authority.kind,'local-human');});
test('Missing registered invocation fact is unknown, not inferred from observed interpreter',async()=>{const f=fixture();delete f.runtime.facts.executables;await assert.rejects(f.service.inspect({taskId:'task'},{}),/observed registered runtime/);});
test('Negative registration_match is never rescued by equal configured/observed strings',async()=>{const f=fixture();f.runtime.facts.python.registration_match=false;await assert.rejects(f.service.inspect({taskId:'task'},{}),/observed registered runtime/);});

function prepareDeployment(records,worker,args,localReview){return prepareActualDeployment(records,withComputeProject(worker,records.read(args.taskId)),args,localReview);}
});

await __describe("scientific-input-selection", async () => {
const test = __node_test;
test('Natural human requests select exact scientific inputs while refusing URLs, UNC and negative requests',()=>{
 assert.deepEqual(explicitScientificInputs('使用 "D:\\demo files\\nep.txt" 和 /home/user/run.py，参考 /mnt/d/data/GAScfg.yaml'),['/mnt/d/demo files/nep.txt','/home/user/run.py','/mnt/d/data/GAScfg.yaml']);
 assert.deepEqual(explicitScientificInputs('不要读取 /home/user/private.json；使用 /home/user/model.xyz。 https://example.org/run.py \\\\host\\share\\x.py'),['/home/user/model.xyz']);
 assert.deepEqual(explicitScientificInputs('不要读取 /home/user/POSCAR；使用 /home/user/model.xyz'),['/home/user/model.xyz']);
 assert.deepEqual(explicitScientificInputs('do not import /home/user/private.py'),[]);
});
});

await __describe("task-asset-import", async () => {
const test = __node_test;
const fs = _imp_3_fs;
const root=path.resolve('validation/local/asset-import-unit');await fs.mkdir(root,{recursive:true});
const digest=v=>createHash('sha256').update(v).digest('hex');
async function fixture(t){const directory=await fs.mkdtemp(path.join(root,'case-')),file=path.join(directory,'atoms.xyz'),contents='2\nSynthetic UI import fixture only\nH 0 0 0\nH 1.1 0 0\n';await fs.writeFile(file,contents);t.after(async()=>{const resolved=path.resolve(directory),relative=path.relative(root,resolved);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(resolved,{recursive:true,force:true});});let provider='codex',deleted=false,bound='task',picked=file,task={id:'task',name:'Synthetic task',provider:'codex',threadId:'thread',projectId:'project',parameterRevision:7,parameters:{files:['/owned/workflow.json'],engine:'pygas.build'},authoring:{projectId:'project',environmentId:'env',inputRoot:'/owned',imports:[]},composition:{graphPath:'/owned/workflow.json',expected:{journal_sha256:'a'.repeat(64)}},review:{status:'ready'},deployment:{prepared:{artifactId:'existing-prepared'}}};const saved=[],calls=[],dialogs=[];const output='/owned/import-fixture/atoms.xyz',sha=digest(contents),response={project:{id:'project'},input_root:'/owned',environment_id:'env',environments:[{id:'env'}],imports:[{source:'/selected/atoms.xyz',path:output,status:'passed',sha256:sha}],assets:[{id:'registered-asset',name:'atoms.xyz',path:output,kind:'structure'}]};const records={read:id=>{assert.equal(id,'task');if(deleted)throw Error('Unknown task');return structuredClone(task);},save:v=>{task=structuredClone(v);saved.push(structuredClone(v));},deleted:()=>deleted,bound:()=>({id:bound})};const deps={records,getProvider:()=>provider,chooseFile:async()=>{dialogs.push('native');return picked;},toLinuxPath:()=>'/selected/atoms.xyz',worker:{request:async(method,target,data)=>{calls.push({method,target,data:structuredClone(data)});return structuredClone(target==='/api/authoring/context'?response:{path:output,name:output,sha256:sha,size:Buffer.byteLength(contents),text:contents});}}};return {deps,directory,file,contents,sha,response,calls,saved,dialogs,get task(){return task},set task(v){task=v},provider:v=>provider=v,deleted:v=>deleted=v,bound:v=>bound=v,pick:v=>picked=v};}
const run=f=>importTaskAsset(f.deps,{taskId:'task'});
test('native picked regular file is streamed, copied and read back before metadata only authority',async t=>{const f=await fixture(t),old=structuredClone(f.task),result=await run(f);assert.equal(result.cancelled,false);assert.deepEqual(result.asset,{id:'registered-asset',name:'atoms.xyz',path:'/owned/import-fixture/atoms.xyz',sha256:f.sha,kind:'structure'});assert.deepEqual(result.receipt,{kind:'human_native_dialog',sha256:f.sha,size:Buffer.byteLength(f.contents)});assert.equal(f.dialogs.length,1);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].data,{workspace_id:'task',project_id:'project',environment_id:'env',name:'Synthetic task',structure_paths:[],selected_paths:['/selected/atoms.xyz']});assert.deepEqual(f.task.parameters,old.parameters);assert.deepEqual(f.task.composition,old.composition);assert.deepEqual(f.task.review,old.review);assert.deepEqual(f.task.deployment,old.deployment);assert.equal(f.task.parameterRevision,old.parameterRevision);assert.equal(f.task.authoring.imports[0].authority,'human_native_dialog');assert.equal(f.task.authoring.imports[0].sha256,f.sha);});
for(const field of ['path','projectId','environmentId','provider','grant','selected_paths'])test('renderer cannot inject '+field,async t=>{const f=await fixture(t);await assert.rejects(importTaskAsset(f.deps,{taskId:'task',[field]:'external'}),/only.*taskId/);assert.equal(f.dialogs.length,0);assert.equal(f.calls.length,0);});
test('native cancel is not a synthetic asset or file write',async t=>{const f=await fixture(t);f.pick(null);assert.deepEqual(await run(f),{taskId:'task',cancelled:true});assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);});
for(const picked of [[],{},['one.xyz','two.xyz'],'relative.xyz','\\\\server\\share\\atoms.xyz'])test('invalid or multiple native result fails closed '+JSON.stringify(picked),async t=>{const f=await fixture(t);f.pick(picked);await assert.rejects(run(f),/one local absolute/);assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);});
test('current provider cannot import into another provider conversation',async t=>{const f=await fixture(t);f.provider('deepseek');await assert.rejects(run(f),/owning conversation/);assert.equal(f.dialogs.length,0);});
test('late provider/conversation change while dialog is open rejects before copy',async t=>{for(const change of [f=>f.provider('deepseek'),f=>f.bound('other')]){const f=await fixture(t);f.deps.chooseFile=async()=>{change(f);return f.file;};await assert.rejects(run(f),/changed/);assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);}});
test('closed/deleted conversation cannot attach late asset authority',async t=>{const f=await fixture(t),normal=f.deps.worker.request;f.deps.worker.request=async(...args)=>{const result=await normal(...args);f.deleted(true);return result;};await assert.rejects(run(f),/Unknown task|changed/);assert.equal(f.saved.length,0);});
test('input/graph revision changed during dialog never alters the new workflow',async t=>{const f=await fixture(t);f.deps.chooseFile=async()=>{f.task.parameterRevision++;return f.file;};await assert.rejects(run(f),/changed/);assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);});
for(const phase of ['validating','submitting','unknown'])test('next input import preserves original '+phase+' execution and its immutable prepared identity',async t=>{const f=await fixture(t);f.task.execution={phase,artifactId:'existing-prepared',inputIdentity:'original-immutable-inputs'};f.task.artifacts=[{id:'existing-prepared',kind:'run'}];const before=structuredClone(f.task),result=await run(f);assert.equal(result.cancelled,false);assert.equal(f.dialogs.length,1);assert.deepEqual(f.task.execution,before.execution);assert.deepEqual(f.task.artifacts,before.artifacts);assert.deepEqual(f.task.deployment,before.deployment);assert.deepEqual(f.task.parameters,before.parameters);assert.equal(f.task.parameterRevision,before.parameterRevision);assert.equal(f.calls.some(call=>/prepare|submit|validate|cancel/.test(call.target)),false);});
test('credential directory and injected protected roots rejected before worker reads',async t=>{for(const kind of ['credential','protected']){const f=await fixture(t);if(kind==='credential'){const folder=path.join(f.directory,'.ssh');await fs.mkdir(folder);const file=path.join(folder,'private.json');await fs.writeFile(file,'synthetic private data');f.pick(file);}else f.deps.protectedRoots=[f.directory];await assert.rejects(run(f),/Credential|protected/);assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);}});
test('unsupported file and directories are not calculation input imports',async t=>{const f=await fixture(t),file=path.join(f.directory,'payload.exe');await fs.writeFile(file,'not executable');f.pick(file);await assert.rejects(run(f),/supported scientific/);f.pick(f.directory);await assert.rejects(run(f));assert.equal(f.calls.length,0);});
test('hard-linked source is rejected as a file alias',async t=>{const f=await fixture(t),link=path.join(f.directory,'alias.xyz');await fs.link(f.file,link);f.pick(link);await assert.rejects(run(f),/single-link/);assert.equal(f.calls.length,0);});
test('ancestor junction/symlink is rejected without dereferencing its input',async t=>{const f=await fixture(t),target=path.join(f.directory,'real'),link=path.join(f.directory,'linked');await fs.mkdir(target);await fs.writeFile(path.join(target,'atoms.xyz'),f.contents);await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');f.pick(path.join(link,'atoms.xyz'));await assert.rejects(run(f),/links\/junctions/);assert.equal(f.calls.length,0);});
test('source above512MiB is rejected before streaming or worker copy',async t=>{const f=await fixture(t);await fs.truncate(f.file,512*1024*1024+1);await assert.rejects(run(f),/512MiB/);assert.equal(f.calls.length,0);});
for(const [name,change]of Object.entries({project:f=>f.response.project.id='other',root:f=>f.response.input_root='/other',environment:f=>{f.response.environment_id='other';f.response.environments=[];},failedImport:f=>f.response.imports[0].status='blocked',wrongSHA:f=>f.response.imports[0].sha256='f'.repeat(64),traversal:f=>f.response.imports[0].path='/owned/../outside/atoms.xyz',missingAsset:f=>f.response.assets=[],wrongName:f=>f.response.assets[0].name='different.xyz'}))test('worker '+name+' mismatch never grants imported input authority',async t=>{const f=await fixture(t);change(f);await assert.rejects(run(f));assert.equal(f.saved.length,0);});
test('worker readback hash/size mismatches are not accepted as copied files',async t=>{const f=await fixture(t),normal=f.deps.worker.request;f.deps.worker.request=async(...args)=>{const result=await normal(...args);return args[1]==='/api/workspace/read'?{...result,sha256:'f'.repeat(64)}:result;};await assert.rejects(run(f),/readback/);assert.equal(f.saved.length,0);});
test('source bytes changed during worker copy fail the second streamed fingerprint',async t=>{const f=await fixture(t),normal=f.deps.worker.request;f.deps.worker.request=async(...args)=>{const result=await normal(...args);if(args[1]==='/api/workspace/read')await fs.writeFile(f.file,f.contents+'changed');return result;};await assert.rejects(run(f),/changed while importing/);assert.equal(f.saved.length,0);});
test('parallel picker attempts cannot open duplicate dialogs or change in-flight scope',async t=>{const f=await fixture(t);let release;f.deps.chooseFile=async()=>new Promise(resolve=>release=resolve);const first=run(f);while(!release)await new Promise(resolve=>setTimeout(resolve,1));await assert.rejects(run(f),/already open/);release(f.file);await first;assert.equal(f.saved.length,1);});
test('optional explicit access denial occurs before native dialog',async t=>{const f=await fixture(t);f.deps.access=async()=>false;await assert.rejects(run(f),/access is denied/);assert.equal(f.dialogs.length,0);});
});

await __describe("task-input-preview", async () => {
const test = __node_test;
function fixture(){let task={id:'t',projectId:'p',parameterRevision:1,parameters:{input:'/grant/source.py',models:['/grant/model.pt'],note:'/grant/secret.txt'},steps:[{id:'input',title:'Input',fields:[{key:'input',type:'file',required:true,label:'Input'},{key:'models',type:'files',required:true,label:'Models'},{key:'note',type:'text',required:false,label:'Note'}]}]};const calls=[];return {records:{read:()=>structuredClone(task)},replace:value=>task={...task,...value},calls,worker:{request:async(...args)=>{calls.push(args);return {path:args[2].name,sha256:'a'.repeat(64),size:3,binary:args[2].name.endsWith('.pt'),text:args[2].name.endsWith('.pt')?null:'abc'};}}};}
test('Task input previews delegate only current saved file references to existing authorized bounded reader',async()=>{const f=fixture();assert.equal((await readTaskInput(f.records,f.worker,{taskId:'t',path:'/grant/source.py'})).text,'abc');assert.equal((await readTaskInput(f.records,f.worker,{taskId:'t',path:'/grant/model.pt'})).binary,true);assert.deepEqual(f.calls[0],['POST','/api/workspace/read',{project_id:'p',name:'/grant/source.py'}]);for(const path of ['/grant/secret.txt','/grant','../other','/arbitrary'])await assert.rejects(readTaskInput(f.records,f.worker,{taskId:'t',path}),/saved file reference/);assert.equal(f.calls.length,2);});
test('Task input preview rejects extra privilege fields and late task revision/project changes',async()=>{for(const extra of [{projectId:'other'},{root:'/parent'},{offset:4}]){const f=fixture();await assert.rejects(readTaskInput(f.records,f.worker,{taskId:'t',path:'/grant/source.py',...extra}),/Invalid/);assert.equal(f.calls.length,0);}for(const change of [{parameterRevision:2},{projectId:'other'},{parameters:{input:'/grant/changed.py'}}]){const f=fixture();f.worker.request=async()=>{f.replace(change);return {text:'old bytes'};};await assert.rejects(readTaskInput(f.records,f.worker,{taskId:'t',path:'/grant/source.py'}),/changed while/);}});
});

await __describe("task-stage", async () => {
const test = __node_test;
const fs = _imp_0_fs;
test('Actual empty-engine/cv/files shape exposes real contract, derives only saved private/source values and never sends provider',async()=>{const f=stageFixture(),before=clone(f.task()),v=await f.stage.inspect({taskId:'task'},{});assert.equal(v.currentEngine,'');assert.deepEqual(v.supportedEngines,['pygas.build']);assert.deepEqual(v.fields.map(x=>x.key),engineContracts.engines['pygas.build'].required_parameters);assert.deepEqual(v.values.atom_selection,f.generated.spec.atom_selection);assert.equal(v.values.cv_definition,f.generated.spec.formula);assert.equal(v.values.cv_units,f.generated.spec.units);assert.equal(v.values.pbc_convention,f.generated.spec.pbc);assert.equal(v.values.family,'WTMetaDGaussianBias');assert.equal(v.values.cutoff,3);assert.equal(v.values.output_file,'bias.pt');assert.deepEqual(v.missingFields,[]);for(const key of nativeKeys)assert.match(v.provenance[key].sha256,/^[a-f0-9]{64}$/);assert.deepEqual(f.task(),before);assert.equal(f.calls.every(c=>['/api/pygas/composition/read','/api/workspace/read','/api/custom-cv/read'].includes(c.target)),true);});
test('Explicit human same-task stage save changes only draft parameters/fields, invalidates authority and preserves runs/private evidence',async()=>{const f=stageFixture(),before=clone(f.task()),entry=clone(f.entry),result=await configured(f),t=f.task();assert.equal(result.status,'draft');assert.equal(t.id,before.id);assert.equal(t.threadId,before.threadId);assert.equal(t.parameters.engine,'pygas.build');assert.equal(t.parameters.cv.ell,.2);assert.equal(t.parameters.cv.formula,before.parameters.cv.formula);assert.equal(t.parameters.cv.atom_selection.join(','),t.parameters.atom_selection.join(','));assert.equal(t.parameterRevision,before.parameterRevision+1);assert.equal(t.review.status,'not_run');assert.equal(t.deployment.prepared,undefined);assert.equal(t.deployment.request,undefined);assert.equal(t.localInputReview.status,'stale');assert.deepEqual(t.artifacts,before.artifacts);assert.deepEqual(t.customCv,before.customCv);assert.deepEqual(f.entry,entry);assert.deepEqual(t.authoring,before.authoring);assert.deepEqual(t.composition,before.composition);assert.equal(t.steps[0].fields[0].key,'engine');assert.equal(t.steps.some(s=>s.fields.some(f=>f.key==='cv.ell')),true);assert.equal(f.calls.some(x=>/prepare|build|validate|sharing|save/.test(x.target)),false);});
test('Configured canonical stage can enter independent local review without AI ready or private sharing',async()=>{const f=stageFixture();await configured(f);const i=await viewed(f);assert.equal(i.engine,'pygas.build');assert.equal(f.task().review.status,'not_run');assert.equal(f.task().customCv.sharing.codex,false);assert.equal(i.entries.length,4);});
test('Source-derived metadata cannot be edited after stage save and still pass local completeness review',async()=>{const f=stageFixture();await configured(f);f.mutate(t=>t.parameters.cutoff=9);await assert.rejects(f.service.inspect({taskId:'task'},{}),/source-derived/);});
test('Unknown/no-private definition remains visible incomplete, and saving null native fields stays a draft',async()=>{const f=stageFixture({privateCv:false,bias:false}),v=await f.stage.inspect({taskId:'task'},{});assert.deepEqual(v.readOnly,['output_file','cutoff']);assert.deepEqual(v.missingFields,['family','cv_definition','pbc_convention']);assert.equal(v.provenance.cv_units,undefined);assert.equal(v.provenance.atom_selection,undefined);const r=await f.stage.save({taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values:v.values},{});assert.equal(r.status,'draft');assert.equal(r.missingFields.includes('family'),true);await assert.rejects(f.service.inspect({taskId:'task'},{}),/引擎技术输入尚未补齐.*family.*cv_definition.*pbc_convention/);});
test('Only explicitly entered unknown structured native values are accepted; no guessed CV family',async()=>{const f=stageFixture({privateCv:false,bias:false}),v=await f.stage.inspect({taskId:'task'},{}),values={...v.values,family:'human-reviewed CV-only procedure',cv_definition:'s = human-defined scalar',cv_units:['1'],atom_selection:[0,1],pbc_convention:'human-reviewed row cell'};await f.stage.save({taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values},{});assert.equal(f.task().parameters.family,values.family);assert.deepEqual(f.task().parameters.cv_units,['1']);});
for(const field of nativeKeys)test('Cannot override a proven source native value '+field,async()=>{const f=stageFixture(),v=await f.stage.inspect({taskId:'task'},{}),values={...v.values,[field]:field==='cutoff'?4:field==='atom_selection'?[1,0]:'forged'};await assert.rejects(f.stage.save({taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values},{}),/source-derived|Invalid structured/);assert.equal(f.task().parameters.engine,'');});
for(const kind of ['family','cv_definition','cv_units','atom_selection','cutoff'])test('Invalid structured unknown field '+kind+' remains blocked',async()=>{const f=stageFixture({privateCv:false,bias:false});if(kind==='cutoff'){delete f.pair.graph.settings.cutoff;f.rebind();}const v=await f.stage.inspect({taskId:'task'},{}),bad={family:{exec:'x'},cv_definition:23,cv_units:[null],atom_selection:[.5],cutoff:-1};await assert.rejects(f.stage.save({taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values:{...v.values,[kind]:bad[kind]}},{}),/Invalid structured/);});
for(const extra of ['path','projectId','environmentId','receipt','review','sharing','files','execute'])test('Hidden stage mutator request key '+extra+' is rejected before worker reads',async()=>{const f=stageFixture();await assert.rejects(f.stage.inspect({taskId:'task',[extra]:'forged'},{}),/Invalid typed/);assert.equal(f.calls.length,0);const v=await f.stage.inspect({taskId:'task'},{});await assert.rejects(f.stage.save({taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values:{...v.values,[extra]:'forged'}},{}),/declared canonical/);});
for(const kind of ['selection','revision','private-version','deleted','worker','pair-source'])test('Late '+kind+' during awaited current reads produces zero task writes',async()=>{const f=stageFixture(),before=clone(f.task());let once=false;f.hooks['/api/pygas/composition/read']=()=>{if(once)return;once=true;if(kind==='selection')f.changeSelection();if(kind==='revision')f.mutate(t=>t.parameterRevision++);if(kind==='private-version')f.mutate(t=>t.customCv.revision='d'.repeat(32));if(kind==='deleted')f.remove();if(kind==='worker')f.worker.connection={...f.worker.connection};if(kind==='pair-source')f.pair.composition.source_sha256='0'.repeat(64);};await assert.rejects(f.stage.inspect({taskId:'task'},{}));assert.equal(f.task().parameters.engine,before.parameters.engine);assert.equal(f.task().stageConfiguration,undefined);});
for(const kind of ['revision','pair','private','selection','changed-file'])test('Save rejects stale inspection '+kind+' without new stage authority',async()=>{const f=stageFixture(),v=await f.stage.inspect({taskId:'task'},{});if(kind==='revision')f.mutate(t=>t.parameterRevision++);if(kind==='pair')f.pair.catalog.source.files['base/bias.py']='0'.repeat(64);if(kind==='private')f.entry.expected.revision='d'.repeat(32);if(kind==='selection')f.changeSelection();if(kind==='changed-file')f.files.set(directory+'/model.xyz','changed');await assert.rejects(f.stage.save({taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values:v.values},{}));assert.equal(f.task().parameters.engine,'');});
test('Superseded and reused challenges cannot save; fake inspection has zero writes',async()=>{const f=stageFixture(),a=await f.stage.inspect({taskId:'task'},{}),b=await f.stage.inspect({taskId:'task'},{});await assert.rejects(f.stage.save({taskId:'task',inspectionId:a.inspectionId,engine:'pygas.build',values:a.values},{}),/stale/);await f.stage.save({taskId:'task',inspectionId:b.inspectionId,engine:'pygas.build',values:b.values},{});await assert.rejects(f.stage.save({taskId:'task',inspectionId:b.inspectionId,engine:'pygas.build',values:b.values},{}),/consumed/);await assert.rejects(f.stage.save({taskId:'task',inspectionId:'fake',engine:'pygas.build',values:b.values},{}),/forged/);});
for(const status of ['unknown','submitting','validating','running','queued'])test('Next stage draft remains editable while original '+status+' run identity is preserved',async()=>{const f=stageFixture();f.mutate(t=>t.execution={phase:status,status,artifactId:'real-preserved',inputIdentity:'original-immutable-inputs'});const before=clone(f.task()),result=await configured(f),saved=f.task();assert.equal(result.status,'draft');assert.equal(saved.parameters.engine,'pygas.build');assert.equal(saved.parameterRevision,before.parameterRevision+1);assert.deepEqual(saved.execution,before.execution);assert.deepEqual(saved.artifacts,before.artifacts);assert.deepEqual(saved.customCv,before.customCv);assert.equal(saved.deployment.prepared,undefined);assert.equal(saved.review.status,'not_run');assert.equal(f.calls.some(call=>/prepare|submit|validate|cancel/.test(call.target)),false);});
test('Other engines and arbitrary execution stage are not silently converted',async()=>{const f=stageFixture();f.mutate(t=>t.parameters.engine='pydyn.sampling');await assert.rejects(f.stage.inspect({taskId:'task'},{}),/explicit stage editor/);assert.equal(f.calls.length,0);});
test('Nonhuman cannot inspect/save, and no MCP registration exists',async()=>{const f=stageFixture();f.setStageHuman(false);await assert.rejects(f.stage.inspect({taskId:'task'},{}),/Trusted human/);assert.equal(f.calls.length,0);const ipc=fs.readFileSync(new URL("../../backend/main/workspace/task-stage-ipc.mjs",import.meta.url),'utf8');assert.match(ipc,/\['inspect','save'\]/);assert.doesNotMatch(ipc,/mcp|tools\/call|worker\.request/);});

for(const engine of ['bias.validate','gpumd.sampling'])test('Human explicitly reconfigures '+engine+' back to canonical build without reusing consumer receipt or changing registration',async()=>{const f=stageFixture();f.mutate(t=>{t.parameters.engine=engine;t.localInputReview={status:'confirmed',receiptId:'old-consumer'};});const before=clone(f.task());await configured(f);assert.equal(f.task().parameters.engine,'pygas.build');assert.equal(f.task().localInputReview.status,'stale');assert.deepEqual(f.task().authoring,before.authoring);assert.deepEqual(f.task().customCv,before.customCv);assert.equal(f.task().parameters.cv.ell,before.parameters.cv.ell);});
});

await __describe("terminal-execution-cache", async () => {
const test = __node_test;
test('Windows execution cache stays outside an existing Low-integrity profile and preserves its location',()=>{
 const profile='D:\\project\\.config';
 assert.equal(terminalExecutionCache({platform:'win32',profileRoot:profile,localAppData:'C:\\Users\\Fixture\\AppData\\Local'}),'C:\\Users\\Fixture\\AppData\\Local\\GPU Sampling Studio\\terminal-runtime');
 assert.equal(profile,'D:\\project\\.config');
 assert.equal(terminalExecutionCache({platform:'linux',profileRoot:'/fixture/profile'}),path.join('/fixture/profile','shared-terminal','runtime'));
});
test('missing Windows local cache uses explicit home and refuses unsafe or profile-contained locations',()=>{
 assert.equal(terminalExecutionCache({platform:'win32',profileRoot:'D:\\profile',localAppData:'',home:'C:\\Users\\Fixture'}),'C:\\Users\\Fixture\\AppData\\Local\\GPU Sampling Studio\\terminal-runtime');
 for(const localAppData of ['relative','\\\\network\\share','D:\\profile','D:\\profile\\nested','C:\\bad\npath'])assert.throws(()=>terminalExecutionCache({platform:'win32',profileRoot:'D:\\profile',localAppData}),/invalid_root/);
});
});
