import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readdir,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {apply as applyDshPolicy} from '../../agent/providers/dsh-policy.mjs';
import {resolveDshRuntime} from '../../desktop/platform/dsh-runtime.mjs';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {ScientificSkills} from '../../agent/skills/scientific-skills.mjs';
import {softwareDocs,softwareDocDefinitions} from '../../backend/main/tools/public-software-docs.mjs';
import {releaseToolNames} from '../../contracts/tools/release-tool-sources.mjs';
import {readReleaseToolSources} from '../../agent/skills/release-tool-catalog.mjs';
import {tools as workflowCatalog} from '../../frontend/features/workflows/workflow-catalog.mjs';
import {checkReleaseSources,checkSkillContracts} from '../../scripts/check-skill-contracts.mjs';

const sources=JSON.parse(await readFile(new URL('../../installation/tool-sources.json',import.meta.url),'utf8'));
const map=JSON.parse(await readFile(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
const synthetic={id:'zircon-scope',name:'ZirconScope',aliases:['Zr Scope'],integration_status:'source_only',guidance_functions:['software.catalog'],
 url:'https://github.com/example/zircon-scope.git',branch:'main',guide:'README.md',validated_commit:'a'.repeat(40)};

async function skillContractFixture(documentId,changeText){
 const projectDir=fileURLToPath(new URL('../../',import.meta.url));
 const bundledRoot=path.join(projectDir,'agent/builtin-skills');
 const entries=await readdir(bundledRoot,{recursive:true,withFileTypes:true});
 const documents=new Map(await Promise.all(entries.filter(entry=>entry.isFile()).map(async entry=>{
  const filename=path.join(entry.parentPath,entry.name);
  const name=path.relative(bundledRoot,filename).split(path.sep).join('/');
  const original=await readFile(filename,'utf8');
  const text=name===documentId?changeText(original):original;
  return [name,{text,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}];
 })));
 assert.ok(documents.has(documentId));
 return {projectDir,map,documents};
}

async function startConversationMcp(t,options){
 const endpoint=new TerminalMcp({terminal:{tools:()=>[]},...options});
 await endpoint.start();
 t.after(()=>endpoint.close());
 endpoint.bindProviderContext('deepseek',{threadId:'chat'});
 const connection=endpoint.providerConnection('deepseek');
 const request=async(method,params)=>{
  const response=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(response.status,200);
  const {result}=await response.json();
  assert.ok(!result.isError);
  return result;
 };
 const call=async(name,args)=>JSON.parse((await request('tools/call',{name,arguments:args})).content[0].text);
 return {request,call,connection,endpoint};
}

test('ordinary chat can read shipped tool guidance then fill an evidence gap from the upstream guide',async t=>{
 const recordedSources=[...sources,synthetic];
 const directory=await mkdtemp(path.join(os.tmpdir(),'aimlab-release-catalog-'));
 const sourceFile=path.join(directory,'tool-sources.json');
 t.after(async()=>{await unlink(sourceFile);await rmdir(directory);});
 await writeFile(sourceFile,JSON.stringify(recordedSources));
 const remoteReads=[];
 const read=async(url,{accept})=>{
  remoteReads.push(String(url));
  assert.equal(accept,'application/vnd.github.raw+json');
  return {url:String(url),type:accept+'; charset=utf-8',text:'Fixture delivery guide'};
 };
 const scientific=new ScientificSkills({map,sources:()=>[],settings:()=>({}),releaseToolSources:readReleaseToolSources(sourceFile),
  bundledRoot:fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url))});
 const {request,call}=await startConversationMcp(t,{scientificSkills:scientific,publicDocs:{
  definitions:softwareDocDefinitions,call:(name,args)=>softwareDocs(name,args,read,sourceFile),
 }});
 const {tools}=await request('tools/list',{});
 const search=tools.find(tool=>tool.name==='search_software_docs');
 const network=tools.find(tool=>tool.name==='read_software_docs');
 assert.deepEqual(search.inputSchema.required,[]);
 assert.deepEqual(search.inputSchema.properties.sources.enum,['bundled','public']);
 assert.equal(search.inputSchema.properties.sources.default,'bundled');
 assert.match(search.description,/inventory offline/);
 assert.match(search.description,/guidance_functions with read_scientific_skill/);
 assert.match(search.description,/Set sources to public.*parallel/);
 assert.match(network.description,/public HTTPS.*parallel with local evidence collection/);
 assert.match(network.description,/explicit offline or internal-only requests/);
 const catalog=await call(search.name,{});
 assert.equal(catalog.source_scope,'bundled');
 assert.equal(catalog.match,'inventory');
 assert.deepEqual(catalog.results.map(tool=>tool.url),recordedSources.map(tool=>tool.url));
 for(const args of [{software:'plumed'},{software:'plumed',sources:'bundled'},{software:'plumed',version:'2.10'}]){
  const local=await call(search.name,args);
  assert.equal(local.status,'passed');
  assert.equal(local.source_scope,'bundled');
  assert.equal(local.match,'not_listed');
  assert.deepEqual(local.results,[]);
  assert.deepEqual(local.sources,[{name:'AIMatterLab tool source catalog',status:'available'}]);
 }
 for(const entry of recordedSources){
  for(const alias of releaseToolNames(entry)){
   const result=await call(search.name,{software:alias});
   assert.equal(result.results.length,1);
   assert.equal(result.results[0].validated_commit,entry.validated_commit);
   assert.equal(result.results[0].integration_status,entry.integration_status);
   assert.deepEqual(result.results[0].guidance_functions,entry.guidance_functions);
  }
 }
 for(const [name,document_id,details] of [
  ['HotHam','studio-tool-discovery/references/hotham.md',[
   /10 epochs/,
   /LCAO model learns .*H\(R\).*RMSE plus MAE/,
   /`olp` writes the supplied overlap/,
   /parser rejects `batch_size`.*one structure per batch/,
   /exporter reads `trainset` in the inference YAML/,
   /solves the DOS mesh first.*then the band path, one k point at a time/,
  ]],
  ['HotPP','studio-training-workflow/references/hotpp.json',[/Data.testSet/]],
 ]){
  const {guidance_functions:[function_id]}=catalog.results.find(tool=>tool.name===name);
  const entry=await call('read_scientific_skill',{function_id});
  assert.ok(entry.document_ids.includes(document_id));
  const focused=await call('read_scientific_skill',{function_id,document_id});
  assert.equal(focused.status,'passed',focused.reason);
  assert.equal(focused.document_id,document_id);
  for(const detail of details)assert.match(focused.text,detail);
 }
 const routed=await scientific.context.prepare('first-turn','deepseek',{text:'查一下Zr-Scope'});
 assert.equal(routed.status,'passed');
 assert.deepEqual(routed.routes,['software.catalog']);
 assert.deepEqual(routed.attachments.map(x=>x.name),['studio-tool-discovery/SKILL.md']);
 const hot=sources.find(row=>row.name==='HotHam');
 for(const software of ['hotham','HOT-Ham','hot ham']){
  const result=await call(search.name,{software});
  assert.equal(result.results[0].url,hot.url);
  assert.equal(result.results[0].guide,hot.guide);
 }
 const result=await call(search.name,{software:'HotHam',version:hot.validated_commit});
 const row=result.results[0];
 assert.equal(row.requested_version_match,'exact_commit');
 assert.equal(row.integration_status,'source_only');
 assert.deepEqual(remoteReads,[]);
 const guide=await call('read_software_docs',{url:row.guide_url});
 const expected='https://api.github.com/repos'+new URL(hot.url).pathname.slice(0,-4)+'/contents/'+hot.guide+'?ref='+hot.validated_commit;
 assert.deepEqual(remoteReads,[expected]);
 assert.deepEqual(guide,{source:row.guide_url,retrieved_from:expected,text:'Fixture delivery guide',truncated:false});
 const install=await call('read_software_docs',{url:new URL('install.md',guide.source).href});
 assert.equal(install.retrieved_from,expected.replace('SKILL.md','install.md'));
 assert.ok(install.source.includes('/'+hot.validated_commit+'/'));
});

test('release MD and TorchNEP guidance remains readable when mixed pyGAS routes require sharing',async t=>{
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const scientificSkills=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({})});
 const restricted=await scientificSkills.call('read_scientific_skill',{function_id:'sampling.gpumd'},{provider:'deepseek'});
 assert.equal(restricted.status,'permission_required');
 const {call}=await startConversationMcp(t,{scientificSkills});
 for(const [function_id,document_id] of [
  ['md.pydyn','studio-md-workflow/references/pydyn.json'],
  ['md.gpumd','studio-md-workflow/references/gpumd.json'],
 ]){
  const md=await call('read_scientific_skill',{function_id});
  assert.equal(md.status,'passed',md.reason);
  assert.match(md.text,/Reload the serialized bias on the actual target/);
  assert.match(md.text,/explicit .*\.pt2.* selects AOTI. Incompatible loads fail without fallback/);
  assert.ok(md.document_ids.includes(document_id));
  const reference=await call('read_scientific_skill',{function_id,document_id});
  assert.equal(reference.status,'passed',reference.reason);
 }
 const trainer=await call('read_scientific_skill',{
  function_id:'training.torchnep',document_id:'studio-training-workflow/references/torchnep.json',
 });
 assert.equal(trainer.status,'passed',trainer.reason);
 assert.match(trainer.text,/built-in worker engine list has no TorchNEP adapter/);
});

test('a conversation without a worker can discover and read the bundled GPUMD NEB JSON reference',async t=>{
 const bundledRoot=new URL('../../agent/builtin-skills/',import.meta.url);
 const scientificSkills=new ScientificSkills({map,sources:()=>[],settings:()=>({}),bundledRoot:fileURLToPath(bundledRoot)});
 const {request,call}=await startConversationMcp(t,{scientificSkills});
 const functionId='neb.gpumd';
 const documentId='studio-neb-workflow/references/neb.json';

 const reader=(await request('tools/list',{})).tools.find(tool=>tool.name==='read_scientific_skill');
 assert.ok(reader?.inputSchema.properties.function_id.enum.includes(functionId));
 const route=await call(reader.name,{function_id:functionId});
 assert.equal(route.status,'passed',route.reason);
 assert.ok(route.document_ids.includes(documentId));
 assert.deepEqual(route.attachments.map(attachment=>attachment.name),['studio-neb-workflow/SKILL.md']);

 const focused=await call(reader.name,{function_id:functionId,document_id:documentId});
 assert.equal(focused.status,'passed',focused.reason);
 assert.equal(focused.document_id,documentId);
 const body=await readFile(new URL(documentId,bundledRoot),'utf8');
 assert.equal(focused.text,body);
 assert.equal(focused.attachments.length,1);
 assert.equal(focused.attachments[0].name,documentId);
 assert.equal(focused.attachments[0].sha256,createHash('sha256').update(body).digest('hex'));
});

test('missing release entries and unmatched revisions produce local receipts without querying public indexes',async()=>{
 const name='search_software_docs';
 const noNetwork=()=>assert.fail('Local software discovery contacted a public index');
 const hot=sources.find(row=>row.name==='HotHam');
 const result=await softwareDocs(name,{software:'HotHam',version:'other-release'},noNetwork);
 assert.equal(result.match,'unverified');
 assert.equal(result.source_scope,'bundled');
 assert.equal(result.results[0].validated_commit,hot.validated_commit);
 assert.equal(result.results[0].requested_version_match,'unverified');
 assert.deepEqual(result.sources.map(source=>source.status),['available']);
 const missing=await softwareDocs(name,{software:'plumed'},noNetwork,new URL('./missing-release-inventory.json',import.meta.url));
 assert.equal(missing.status,'failed');
 assert.equal(missing.match,'catalog_unavailable');
 assert.deepEqual(missing.results,[]);
 for(const args of [{version:'2'},{sources:'public'},{software:'plumed',sources:'remote'},
  {software:'plumed',sources:null},{software:'C:/private/inputs/run.in',sources:'public'},[]]){
  await assert.rejects(softwareDocs(name,args,noNetwork),/public software name/);
 }
});

test('the official DSH adapter uses the same local and explicit public search on the authenticated Terminal MCP',async t=>{
 const requests=[];
 const read=async target=>{
  const url=new URL(target);
  requests.push(url);
  if(url.hostname==='api.github.com')return {text:JSON.stringify({items:[
   {full_name:'plumed/plumed2',html_url:'https://github.com/plumed/plumed2',description:'Fixture upstream'}]})};
  assert.equal(url.hostname,'pypi.org');
  return {text:JSON.stringify({info:{name:'plumed',version:'2.10.0',package_url:'https://pypi.org/project/plumed/'}})};
 };
 const {connection,endpoint}=await startConversationMcp(t,{publicDocs:{
  definitions:softwareDocDefinitions,call:(name,args)=>softwareDocs(name,args,read),
 }});
 const runtime=resolveDshRuntime(),previous=process.env.GSS_MCP_TOKEN,definitions=[];
 process.env.GSS_MCP_TOKEN=connection.tokens.mcp;
 t.after(()=>{if(previous===undefined)delete process.env.GSS_MCP_TOKEN;else process.env.GSS_MCP_TOKEN=previous;});
 await applyDshPolicy({tools:{register:def=>definitions.push(def),guard(){},schemas:()=>definitions},
  systemPrompt:{section(){}},on(){},effect(){}},{workerUrl:connection.url+'/mcp',
  mcpModule:runtime.mcpModule,toolsModule:runtime.toolsModule,workflow:false,instructions:'Scoped public software lookup fixture',models:[]});
 const definition=definitions.find(tool=>tool.name==='mcp__gpusampling__search_software_docs');
 assert(definition,'Ordinary DSH sessions expose the software-discovery tool');
 const search=async args=>JSON.parse((await definition.execute(args,{signal:new AbortController().signal})).content[0].text);
 const local=await search({software:'plumed'});
 assert.equal(local.match,'not_listed');
 assert.equal(local.source_scope,'bundled');
 assert.equal((await search({software:'HotHam',version:'other-release'})).match,'unverified');
 assert.equal(requests.length,0);
 await assert.rejects(search({software:'plumed',sources:'all'}),/sources/i);
 await assert.rejects(search({software:'C:/private/project/input.dat',sources:'public'}),/public software name/);
 await assert.rejects(search({software:'plumed',sources:'public',project_files:['/private/project/input.dat']}),/project_files/);
 assert.equal(requests.length,0);
 const [online,concurrentLocal]=await Promise.all([
  search({software:'plumed',version:'2.10.0',sources:'public'}),search({software:'plumed',sources:'bundled'}),
 ]);
 assert.equal(concurrentLocal.match,'not_listed');
 assert.equal(online.status,'passed');
 assert.equal(online.source_scope,'public');
 assert.deepEqual(online.sources.map(source=>source.name),['GitHub','PyPI']);
 assert.deepEqual(online.results.map(row=>[row.name,row.requested_version_match]),[['plumed/plumed2','unverified'],['plumed','exact_version']]);
 assert.equal(requests.length,2);
 assert.equal(requests.find(url=>url.hostname==='api.github.com').searchParams.get('q'),'plumed in:name');
 assert.equal(requests.find(url=>url.hostname==='pypi.org').pathname,'/pypi/plumed/2.10.0/json');
 endpoint.revokeProvider('deepseek');
 await assert.rejects(search({software:'plumed',sources:'public'}),/HTTP 403/);
 assert.equal(requests.length,2);
});

test('scoped WorkerClient forwards only public query terms and returns Crossref metadata',async t=>{
 const worker=new WorkerClient();
 worker.connection={url:'http://127.0.0.1:1',tokens:{mcp:'synthetic-upstream',admin:'synthetic-admin'}};
 worker.identity={version:3,connectionId:'fixture-work-id'};
 worker.discoverTools=async id=>({status:200,data:{jsonrpc:'2.0',id,result:{tools:[]}}});
 t.after(()=>worker.close());
 const requests=[];
 const read=async(url,options)=>{
  requests.push({url:String(url),options});
  return {text:JSON.stringify({status:'ok','message-type':'work-list',message:{items:[
   {DOI:'10.5555/fixture-part-1',title:['Phonon modes in a cubic crystal'],author:[{given:'Fixture',family:'Author'},{name:'Fixture Group'}],
    'container-title':['Fixture Journal'],published:{'date-parts':[[2024,3]]},type:'journal-article',abstract:'Unrequested abstract',link:[{URL:'Unrequested text'}]},
   {DOI:'10.5555/missing-title'},
  ]}})};
 };
 worker.setScopedTools(softwareDocDefinitions,(name,args)=>softwareDocs(name,args,read));
 await worker.exposeTools({});
 worker.bindProviderContext('codex',{threadId:'fixture-thread',projectId:'private-project',inputRoot:'/private/project'});
 const scoped=worker.providerConnection('codex');
 const request=(url,token,method,params)=>fetch(url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const list=await (await request(scoped.url,scoped.tokens.mcp,'tools/list',{})).json();
 const tool=list.result.tools.find(value=>value.name==='search_scientific_literature');
 assert.deepEqual(tool.inputSchema.required,['query']);
 assert.equal(tool.inputSchema.additionalProperties,false);
 assert.equal(tool.annotations.readOnlyHint,true);
 assert.equal(requests.length,0);
 const args={query:'Phonons & Γ-point stability',limit:2};
 const params={name:tool.name,arguments:args};
 const call=await request(scoped.url,scoped.tokens.mcp,'tools/call',params);
 assert.equal(call.status,200);
 const {result}=await call.json(),metadata=JSON.parse(result.content[0].text);
 assert.equal(result.isError,false);
 assert.equal(metadata.status,'passed');
 assert.equal(metadata.scope,'bibliographic_metadata');
 assert.equal(metadata.source,'Crossref');
 assert.deepEqual(metadata.results,[{title:'Phonon modes in a cubic crystal',doi:'10.5555/fixture-part-1',url:'https://doi.org/10.5555/fixture-part-1',
  authors:['Fixture Author','Fixture Group'],year:2024,publication:'Fixture Journal',type:'journal-article'}]);
 const [{url,options}]=requests;
 const target=new URL(url);
 assert.equal(metadata.source_url,url);
 assert.equal(target.origin+target.pathname,'https://api.crossref.org/works');
 assert.deepEqual(Object.fromEntries(target.searchParams),{'query.bibliographic':args.query,rows:'2',select:'DOI,title,author,container-title,published,type'});
 assert.deepEqual(options,{accept:'application/json',redirects:0});
 const unscoped=await request(worker.connection.url,worker.connection.tokens.mcp,'tools/call',params);
 assert.equal(unscoped.status,403);
 assert.equal(requests.length,1);
});

test('literature reports a Crossref failure separately from a valid empty result',async()=>{
 const name='search_scientific_literature',query='Cubic silicon elastic constants';
 for(const args of [{query:'  '},{query:'a\nb'},{query,limit:0},{query,limit:11},{query,limit:1.5},{query,project_files:['/private/input']}]){
  await assert.rejects(softwareDocs(name,args,()=>assert.fail('Invalid arguments must not reach the network')),/short public literature query/);
 }
 const empty=await softwareDocs(name,{query},async url=>{
  assert.equal(new URL(url).searchParams.get('rows'),'5');
  return {text:'{"status":"ok","message-type":"work-list","message":{"items":[]}}'};
 });
 assert.equal(empty.status,'passed');
 assert.deepEqual(empty.results,[]);
 const failed=await softwareDocs(name,{query},async()=>({text:'{"status":"failed","message":{}}'}));
 assert.equal(failed.status,'failed');
 assert.equal(failed.code,'crossref_unavailable');
 assert.deepEqual(failed.results,[]);
});

test('source catalog CI permits an additional source-only tool while rejecting unreachable guides or invented native status',()=>{
 const routes=new Map(map.functions.map(route=>[route.id,route]));
 checkReleaseSources([...sources,synthetic],routes);
 assert.throws(()=>checkReleaseSources([...sources,{...synthetic,integration_status:undefined}],routes),/declare release integration status/);
 assert.throws(()=>checkReleaseSources([...sources,{...synthetic,guidance_functions:['fictional.native']}],routes),/assign known runtime guidance functions/);
 assert.throws(()=>checkReleaseSources([...sources,{...synthetic,integration_status:'native_adapter'}],routes),/disagree on built-in adapters/);
});

test('bundled skill CI rejects an entry one byte over 5 KiB',async()=>{
 const fixture=await skillContractFixture('studio-opes-analysis/SKILL.md',text=>{
  const padding=5*1024-Buffer.byteLength(text);
  return text+'\n'+' '.repeat(padding);
 });
 assert.throws(()=>checkSkillContracts(fixture),/studio-opes-analysis\/SKILL\.md: keep the entry within 5 KiB/);
});

test('bundled skill CI rejects stale source anchors in focused Markdown references',async()=>{
 const fixture=await skillContractFixture('studio-neb-workflow/references/native-input.md',
  text=>text+'\nSee `contracts/tools/nonexistent-neb-engine-contract.json`.\n');
 assert.throws(()=>checkSkillContracts(fixture),
  /studio-neb-workflow\/references\/native-input\.md: stale source anchor contracts\/tools\/nonexistent-neb-engine-contract\.json/);
});

test('bundled skill CI rejects GPUMD NEB keys absent from the engine contract',async()=>{
 const fixture=await skillContractFixture('studio-neb-workflow/references/neb.json',text=>{
  const reference=JSON.parse(text);
  reference.parameter_groups.neb.allowed_keys.push('unsupported_fixture_key');
  return JSON.stringify(reference);
 });
 assert.throws(()=>checkSkillContracts(fixture),
  /studio-neb-workflow\/references\/neb\.json: parameter_groups\.neb differs from the gpumd\.neb engine contract/);
});

test('the HotHam source and guide do not imply a native Hamiltonian runner',()=>{
 assert.equal(sources.find(source=>source.id==='hotham').integration_status,'source_only');
 const card=workflowCatalog.find(tool=>tool.id==='hamiltonian');
 assert.equal(card.status,'planned');
 assert.deepEqual(card.engines,[]);
 assert.match(card.description,/收录 HotHam 源码和交付指南.*原生计算后端待接入/);
});
