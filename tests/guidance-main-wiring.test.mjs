import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
import {ScientificSkills} from '../agent/skills/scientific-skills.mjs';
import {localSkills} from '../agent/skills/skills.mjs';
import {selectedSkillContext} from '../agent/skills/skill-context.mjs';
import {managedToolSkillContext} from '../agent/skills/managed-tool-context.mjs';
import {deliverScientificTurn} from '../desktop/scientific-turn.mjs';
import {providerId} from '../agent/providers/contracts.mjs';
import {assertRpc} from '../desktop/security.mjs';
import {toolGuidanceTarget} from '../backend/main/compute/tool-guidance-target.mjs';

function harness(t,{state='active',withOtherTool=false,withGuidanceSource=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-main-guidance-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const archived=withGuidanceSource?path.join(root,'agents','skills','delivery'):path.join(root,'delivery');fs.mkdirSync(archived,{recursive:true});fs.writeFileSync(path.join(archived,'SKILL.md'),'ARCHIVED DELIVERY BODY');
 const otherRoot=path.join(root,'other-source'),other=path.join(otherRoot,'agents','skills','nep');if(withOtherTool){fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'SKILL.md'),'name: other-nep\nOTHER TOOL GUIDANCE');}
 const text='Self-contained configured execution instructions',sha256=createHash('sha256').update(text).digest('hex');
 const facts={schemaVersion:1,revision:'revision-1',state,applicableFunctions:['pygas.bias','env.install'],package:{id:'pygas',version:'1',manifestSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40)},workerBinding:{distribution:'Fixture',root:'/worker',port:8888},target:{kind:'local',projectId:'project',environmentId:'environment',fingerprint:'c'.repeat(64)},activation:{id:'activation',revision:'1',configurationId:'configuration'},archivedResources:[{id:'delivery',role:'delivery',paths:[archived]}],executionSkill:{id:'configured-pygas',sha256,text,resources:[]}};
 const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=[],registrations=[],assignments=[],leaseState=[];
 function visit(node){
  if(ts.isFunctionDeclaration(node)&&['agentRpc','studioSkillRoots','skillGuidanceLease','skillGuidanceScope','assertSkillGuidanceScope','managedSkillRecords','managedSkillRoots','managedSkillEntries'].includes(node.name?.text))functions.push(node.getText(ast));
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>['guidanceLeases','guidanceEpoch'].includes(declaration.name.getText(ast))))leaseState.push(node.getText(ast));
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='scientificSkills')assignments.push(node.getText(ast));
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='handle'&&['agent.rpc','skills.catalog','scientific.skills'].includes(node.arguments[0]?.text))registrations.push(node.getText(ast));
  ts.forEachChild(node,visit);
 }visit(ast);assert.equal(functions.length,8);assert.equal(leaseState.length,2);assert.equal(assignments.length,1);assert.equal(registrations.length,3);
 const map={schema_version:1,skills:[{id:'bias',source:'pygas',folder:'delivery',files:['SKILL.md']}],functions:[{id:'pygas.bias',phase:'authoring',skills:['bias']},{id:'env.install',phase:'installation',skills:['bias']}]};
 if(withOtherTool){map.skills.push({id:'nep',source:'gpumd',folder:'nep',files:['SKILL.md']});map.functions.push({id:'training.nep',phase:'authoring',skills:['nep'],engines:['nep.train']});}
 const owner={provider:'codex',threadId:'thread',taskId:null,projectId:null,environmentId:null,inputRoot:null,serial:1},handlers=new Map(),sent=[],resolved=[],workerLeases=new Map([['codex',{epoch:1,context:{...owner}}]]),terminalLeases=new Map([['codex',{epoch:1,context:{...owner}}]]),bridgeWorkers=new Map([['codex',{transport:'worker'}]]);let scans=0,reads=0,managedQueries=0;
 const sources=[...withOtherTool?[{id:'gpumd',root:otherRoot}]:[],...withGuidanceSource?[{id:'pygas',root}]:[]],toolRecords=[];
 const context={path,ScientificSkills,scientificMap:map,bundledSkillRoot:path.join(root,'bundle'),root,settings:{skillRoots:[archived],sourceRoots:[],pygasSkillProviders:['codex'],scientificSkillProviders:{gpumd:['codex']}},catalog:{list:kind=>kind==='source-binding'?sources:[]},scientificSources:()=>{if(withOtherTool)return sources;throw Error('Active main must not discover sources');},resolveSkillGuidance:async scope=>{resolved.push(scope);return facts;},
  setupInstructions:{allowed:()=>false,prepare:async(_provider,_id,callback)=>callback()},
  workflowContext:{current:()=>owner,revision:()=>owner.serial,begin:()=>owner,assert:()=>{},synchronize:async(_ticket,bind)=>bind('codex',owner)},
  taskRecords:{bound:()=>null,prepareTurn:(_provider,value)=>value},
  worker:{providerScopes:{scopes:workerLeases},providerConnection:()=>({}),connection:{},request:()=>{throw Error('No runtime probe or guide needed');}},terminalMcp:{scopes:{scopes:terminalLeases}},toolPackages:{list:query=>{assert.deepEqual(Object.keys(query),[]);managedQueries++;return toolRecords.filter(value=>value.package_version===value.versions.at(-1));},read:query=>{const value=toolRecords.find(record=>record.package_id===query.package_id&&record.package_version===query.package_version);assert(value);return value;}},
  agents:{active:'codex',bridgeWorkers,threadReady:()=>true,selectContext:()=>{},rpc:async(_provider,_method,params)=>{sent.push(params);return {turn:{id:'acknowledged'}};}},
  ensureTaskAuthoring:async()=>null,assertIdleAgent:()=>{},visibleUserText:input=>input.filter(item=>item.type==='text').map(item=>item.text).join('\n'),providerId,assertRpc,
  localSkills:(...args)=>{scans++;return localSkills(...args);},selectedSkillContext:(...args)=>{reads++;return selectedSkillContext(...args);},managedToolSkillContext,sourceContext:()=>{if(withOtherTool)return 'Other registered source metadata';throw Error('No archived source guidance');},
  deliverScientificTurn,toolGuidanceTarget,emit:()=>{},randomUUID,handle:(name,handler)=>handlers.set(name,handler),
 };
 vm.runInNewContext(leaseState.join('\n')+'\n'+functions.join('\n')+'\n'+assignments[0]+';\n'+registrations.join(';\n'),context);
 const restore=[],operations={exists:0,readdir:0,stat:0,open:0,read:0};let allowArchivedReads=false;
 for(const api of [fs,promises])for(const [method,kind]of Object.entries({existsSync:'exists',readdirSync:'readdir',statSync:'stat',lstatSync:'stat',realpathSync:'stat',openSync:'open',readFileSync:'read',readdir:'readdir',stat:'stat',lstat:'stat',realpath:'stat',open:'open',readFile:'read'}))if(typeof api[method]==='function'){
  const original=api[method];api[method]=function(file,...args){if(typeof file==='string'&&(file===archived||file.startsWith(archived+path.sep))){operations[kind]++;if(!allowArchivedReads)throw Error('Archived main filesystem operation');}return original.call(this,file,...args);};restore.push(()=>{api[method]=original;});
 }
 t.after(()=>restore.reverse().forEach(run=>run()));
 return {root,archived,facts,sent,resolved,operations,owner,workerLeases,terminalLeases,bridgeWorkers,toolRecords,get scans(){return scans;},get reads(){return reads;},get managedQueries(){return managedQueries;},lease:()=>context.skillGuidanceLease('codex'),scope:()=>context.skillGuidanceScope('codex'),policy:scope=>context.scientificSkills.resolvePolicy(scope),readScientific:scope=>context.scientificSkills.call('read_scientific_skill',{function_id:'env.install'},scope),permitArchivedReads:()=>{allowArchivedReads=true;},invoke:(name,value)=>handlers.get(name)(value),turn:extra=>handlers.get('agent.rpc')({provider:'codex',method:'turn/start',params:{threadId:'thread',input:[{type:'text',text:'WTMetaD'}],...extra}})};
}

test('actual main constructor, turn and catalogs consume injected active authority without discovery or local directory scans',async t=>{
 const h=harness(t);assert.equal((await h.turn()).turn.id,'acknowledged');assert.equal(h.scans,0);assert.equal(h.reads,0);assert(h.sent[0].input.some(item=>item.text.includes(h.facts.executionSkill.text)));
 const catalog=await h.invoke('skills.catalog');assert.equal(catalog[0].source,'execution snapshot');assert.equal((await h.invoke('scientific.skills',{provider:'codex'})).guidanceState,'active');assert.equal(h.scans,1);
 assert(h.resolved.every(scope=>scope.provider==='codex'&&scope.threadId==='thread'&&scope.checkCurrent()));
 assert(h.managedQueries>=2);
 assert.deepEqual(h.operations,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('actual main rejects an archived manual attachment and setup selection cannot unseal it',async t=>{
 const h=harness(t);await assert.rejects(h.turn({input:[{type:'text',text:'WTMetaD'},{type:'skill',name:'delivery',path:path.join(h.archived,'SKILL.md')}]}),/unregistered_selection/);assert.equal(h.sent.length,0);
 await h.turn({studioSkillId:'env.install'});assert(h.sent[0].input.some(item=>item.text.includes('sealed')));assert(!JSON.stringify(h.sent).includes('ARCHIVED DELIVERY BODY'));
 assert.deepEqual(h.operations,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('actual main stale authority produces blocked guidance, not an execution snapshot or a legacy fallback',async t=>{
 const h=harness(t,{state:'stale'});await h.turn();assert.equal(h.scans,0);assert(!JSON.stringify(h.sent).includes(h.facts.executionSkill.text));assert.equal((await h.invoke('skills.catalog')).length,0);
 assert.deepEqual(h.operations,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('actual main keeps unrelated scientific guidance and catalog items when one package is configured',async t=>{
 const h=harness(t,{withOtherTool:true});await h.turn({input:[{type:'text',text:'train NEP'}]});
 assert(JSON.stringify(h.sent).includes('OTHER TOOL GUIDANCE'));assert(!JSON.stringify(h.sent).includes(h.facts.executionSkill.text));
 const catalog=await h.invoke('skills.catalog');assert.deepEqual(Array.from(catalog,item=>item.name).sort(),['configured-pygas','other-nep']);assert.deepEqual(h.operations,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('actual main normalizes worker and terminal leases before applying grants to raw MCP epochs',async t=>{
 const h=harness(t,{withGuidanceSource:true}),workerLease=h.lease();assert.equal(h.lease(),workerLease);assert.equal(workerLease.context,h.workerLeases.get('codex').context);
 h.bridgeWorkers.set('codex',{transport:'desktop-terminal'});const terminalLease=h.lease();assert.notEqual(terminalLease.epoch,workerLease.epoch);assert.equal(h.workerLeases.get('codex').epoch,h.terminalLeases.get('codex').epoch);
 h.facts.readGrant={id:'human-repair',purpose:'repair',resourceIds:['delivery'],owner:{provider:'codex',threadId:'thread',taskId:null,leaseEpoch:terminalLease.epoch},authorityRevision:h.facts.revision,activationId:h.facts.activation.id,expiresAt:Date.now()+60000};
 const rawMcpScope={...h.owner,epoch:1,checkCurrent:()=>true},policy=await h.policy(rawMcpScope);assert.equal(policy.hasReadGrant(),true);assert.equal(policy.allowsPath(path.join(h.archived,'SKILL.md')),true);
 assert.deepEqual(h.operations,{exists:0,readdir:0,stat:0,open:0,read:0});h.permitArchivedReads();const granted=await h.readScientific(rawMcpScope);assert.equal(granted.status,'passed');assert(granted.text.includes('ARCHIVED DELIVERY BODY'));assert(h.operations.open>0);
 const grantedOperations={...h.operations},captured=h.scope();h.bridgeWorkers.set('codex',{transport:'worker'});assert.equal(h.lease(),workerLease);assert.equal((await h.policy(rawMcpScope)).hasReadGrant(),false);assert.equal((await h.readScientific(rawMcpScope)).status,'blocked');assert.deepEqual(h.operations,grantedOperations);
 await assert.rejects(h.policy(captured),/scope changed/);h.bridgeWorkers.set('codex',{transport:'desktop-terminal'});h.terminalLeases.set('codex',{epoch:1,context:{...h.owner}});assert.notEqual(h.lease().epoch,terminalLease.epoch);assert.equal((await h.policy(rawMcpScope)).hasReadGrant(),false);assert.equal((await h.readScientific(rawMcpScope)).status,'blocked');assert.deepEqual(h.operations,grantedOperations);
 const resolutions=h.resolved.length;await assert.rejects(h.policy({...rawMcpScope,checkCurrent:()=>false}),/scope changed/);await assert.rejects(h.readScientific({...rawMcpScope,checkCurrent:()=>false}),/scope changed/);assert.equal(h.resolved.length,resolutions);assert.deepEqual(h.operations,grantedOperations);
});

test('actual main resolves historical managed delivery metadata and expands its exact version instead of the latest package',async t=>{
 const h=harness(t),versions=['1'.repeat(64),'2'.repeat(64)],hash=value=>createHash('sha256').update(value).digest('hex');
 for(const [index,package_version]of versions.entries()){
  const snapshot_root=path.join(h.root,'managed',package_version),body='---\nname: historical-delivery\ndescription: Fixture instructions\n---\n[Manual](manual.md)\n',manual='Version '+(index+1)+' instructions';fs.mkdirSync(snapshot_root,{recursive:true});fs.writeFileSync(path.join(snapshot_root,'SKILL.md'),body);fs.writeFileSync(path.join(snapshot_root,'manual.md'),manual);
  h.toolRecords.push({package_id:'managed',package_version,versions,snapshot_root,delivery_skill:{name:'historical-delivery',description:'Fixture instructions',path:'SKILL.md',sha256:hash(body)},files:[['SKILL.md',body],['manual.md',manual]].map(([file,content])=>({path:file,kind:'file',target:null,size:Buffer.byteLength(content),sha256:hash(content)}))});
 }
 const catalog=await h.invoke('skills.catalog'),deliveries=catalog.filter(value=>value.name==='historical-delivery');assert.equal(deliveries.length,2);assert.deepEqual(Array.from(deliveries,value=>value.path).sort(),h.toolRecords.map(value=>path.join(value.snapshot_root,'SKILL.md')).sort());
 const old=h.toolRecords[0],selection={type:'skill',name:old.delivery_skill.name,path:path.join(old.snapshot_root,'SKILL.md')};await h.turn({input:[{type:'text',text:'WTMetaD'},selection]});assert(JSON.stringify(h.sent.at(-1).input).includes('Version 1 instructions'));assert(!JSON.stringify(h.sent.at(-1).input).includes('Version 2 instructions'));
 h.facts.archivedResources.push({id:'historical-delivery',role:'delivery',paths:[selection.path]});const before=h.sent.length;await assert.rejects(h.turn({input:[{type:'text',text:'WTMetaD'},selection]}),/archived/);assert.equal(h.sent.length,before);assert.equal((await h.invoke('skills.catalog')).find(value=>value.path===selection.path).enabled,false);
});
