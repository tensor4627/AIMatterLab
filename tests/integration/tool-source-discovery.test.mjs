import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {ScientificSkills} from '../../agent/skills/scientific-skills.mjs';
import {softwareDocs,softwareDocDefinitions} from '../../backend/main/tools/public-software-docs.mjs';
import {readReleaseToolSources,releaseToolNames} from '../../contracts/tools/release-tool-sources.mjs';
import {tools as workflowCatalog} from '../../frontend/features/workflows/workflow-catalog.mjs';
import {checkReleaseSources} from '../../scripts/check-skill-contracts.mjs';

const sources=JSON.parse(await readFile(new URL('../../installation/tool-sources.json',import.meta.url),'utf8'));
const map=JSON.parse(await readFile(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
const synthetic={id:'zircon-scope',name:'ZirconScope',aliases:['Zr Scope'],integration_status:'source_only',guidance_functions:['software.catalog'],
 url:'https://github.com/example/zircon-scope.git',branch:'main',guide:'README.md',validated_commit:'a'.repeat(40)};

test('a conversation without a worker can discover the shipped tool catalog and read the HotHam guide by commit',async t=>{
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
 const endpoint=new TerminalMcp({terminal:{tools:()=>[]},publicDocs:{definitions:softwareDocDefinitions,call:(name,args)=>softwareDocs(name,args,read,sourceFile)}});
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
 const search=(await request('tools/list',{})).tools.find(tool=>tool.name==='search_software_docs');
 assert.deepEqual(search.inputSchema.required,[]);
 const catalog=await call(search.name,{});
 assert.deepEqual(catalog.results.map(tool=>tool.url),recordedSources.map(tool=>tool.url));
 for(const entry of recordedSources){
  for(const alias of releaseToolNames(entry)){
   const result=await call(search.name,{software:alias});
   assert.equal(result.results.length,1);
   assert.equal(result.results[0].validated_commit,entry.validated_commit);
   assert.equal(result.results[0].integration_status,entry.integration_status);
   assert.deepEqual(result.results[0].guidance_functions,entry.guidance_functions);
  }
 }
 const scientific=new ScientificSkills({map,sources:()=>[],settings:()=>({}),releaseToolSources:readReleaseToolSources(sourceFile),
  bundledRoot:fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url))});
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

test('version requests keep unmatched catalog revisions and external evidence distinct',async()=>{
 const calls=[];
 const result=await softwareDocs('search_software_docs',{software:'HotHam',version:'other-release'},async url=>{
  calls.push(new URL(url).hostname);
  throw Error('offline');
 });
 assert.equal(result.results[0].requested_version_match,'unverified');
 assert.deepEqual(calls,['api.github.com','pypi.org']);
 assert.deepEqual(result.sources.map(source=>source.status),['unavailable','unavailable','available']);
 await assert.rejects(softwareDocs('search_software_docs',{version:'2'}),/public software name/);
 await assert.rejects(softwareDocs('search_software_docs',[]),/public software name/);
});

test('source catalog CI permits an additional source-only tool while rejecting unreachable guides or invented native status',()=>{
 const routes=new Map(map.functions.map(route=>[route.id,route]));
 checkReleaseSources([...sources,synthetic],routes);
 assert.throws(()=>checkReleaseSources([...sources,{...synthetic,integration_status:undefined}],routes),/declare release integration status/);
 assert.throws(()=>checkReleaseSources([...sources,{...synthetic,guidance_functions:['fictional.native']}],routes),/assign known runtime guidance functions/);
 assert.throws(()=>checkReleaseSources([...sources,{...synthetic,integration_status:'native_adapter'}],routes),/disagree on built-in adapters/);
});

test('the HotHam source and guide do not imply a native Hamiltonian runner',()=>{
 assert.equal(sources.find(source=>source.id==='hotham').integration_status,'source_only');
 const card=workflowCatalog.find(tool=>tool.id==='hamiltonian');
 assert.equal(card.status,'planned');
 assert.deepEqual(card.engines,[]);
 assert.match(card.description,/收录 HotHam 源码和交付指南.*原生计算后端待接入/);
});
