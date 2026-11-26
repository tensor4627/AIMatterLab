import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {CodexBridge} from "../../agent/providers/codex.mjs";
import {explicitScientificInputs} from "../../backend/main/workspace/task-authoring.mjs";
import {createWorkbenchImageExporter,writePngAtomically,inspectPng} from "../../desktop/platform/workbench-image.mjs";

function imageFixture() {
 const contents=new EventEmitter(),owner=new EventEmitter(),frame={parent:null,url:'file:///synthetic/index.html'},calls=[];
 // Header bytes are a decoder-injected unit fixture, not a captured renderer image.
 const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(16,16);png.writeUInt32BE(12,20);
 const image={isEmpty:()=>false,getSize:()=>({width:16,height:12}),getScaleFactors:()=>[1,2],toPNG:()=>png};
 Object.assign(contents,{mainFrame:frame,getURL:()=>frame.url,isDestroyed:()=>false,getZoomFactor:()=>1,capturePage:async()=>{calls.push('capture');return image;}});
 Object.assign(owner,{webContents:contents,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,getContentSize:()=>[16,12]});
 const event={sender:contents,senderFrame:frame};
 const options={ownerForEvent:e=>e===event?owner:null,displayScale:()=>2,showSaveDialog:async()=>{calls.push('dialog');return{canceled:true};},decodePng:()=>image,write:()=>calls.push('write')};
 return{contents,owner,image,png,event,calls,options};
}

const imageWait=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};};
test('workbench capture refuses an active private authentication pane before capture or save dialog',async()=>{const f=imageFixture();f.options.privacy=()=>({active:true,revision:1});await assert.rejects(createWorkbenchImageExporter(f.options)({},f.event),/私有认证/);assert.deepEqual(f.calls,[]);});
test('a pane opened and closed while capture is pending still invalidates the private image epoch',async()=>{const f=imageFixture(),wait=imageWait();let state={active:false,revision:0};f.options.privacy=()=>state;f.contents.capturePage=()=>{f.calls.push('capture');return wait.promise;};const pending=createWorkbenchImageExporter(f.options)({},f.event);await Promise.resolve();state={active:true,revision:1};state={active:false,revision:2};wait.resolve(f.image);await assert.rejects(pending,/私有认证/);assert.deepEqual(f.calls,['capture']);});
test('a private pane appearing and disappearing during the save dialog prevents any image write',async()=>{const f=imageFixture(),wait=imageWait();let state={active:false,revision:0};f.options.privacy=()=>state;f.options.showSaveDialog=()=>{f.calls.push('dialog');return wait.promise;};const pending=createWorkbenchImageExporter(f.options)({},f.event);while(!f.calls.includes('dialog'))await new Promise(resolve=>setImmediate(resolve));state={active:true,revision:1};state={active:false,revision:2};wait.resolve({canceled:false,filePath:path.resolve(os.tmpdir(),'synthetic-workbench.png')});await assert.rejects(pending,/私有认证/);assert(!f.calls.includes('write'));});
test('private epoch change after temporary PNG write prevents rename and cleans only its own temporary file',async()=>{
 const f=imageFixture();let state={active:false,revision:0};const operations=[];f.options.privacy=()=>state;f.options.showSaveDialog=async()=>({canceled:false,filePath:path.resolve(os.tmpdir(),'synthetic-workbench.png')});const filesystem={openSync:()=>{operations.push('open');return 5;},writeFileSync:()=>{operations.push('write');state={active:true,revision:1};state={active:false,revision:2};},fsyncSync:()=>operations.push('fsync'),closeSync:()=>operations.push('close'),renameSync:()=>operations.push('rename'),unlinkSync:()=>operations.push('unlink')};f.options.write=(destination,bytes,check)=>writePngAtomically(destination,bytes,check,{filesystem,uuid:()=> 'owned-synthetic'});await assert.rejects(createWorkbenchImageExporter(f.options)({},f.event),/私有认证/);assert(!operations.includes('rename'));assert.equal(operations.filter(value=>value==='unlink').length,1);
});

test('unsupported Codex catalog query returns an explicit failure and keeps the conversation connected',()=>{
 const bridge=new CodexBridge({strictIsolation:true}),events=[],sent=[];let kills=0;
 bridge.process={stdin:{destroyed:false,write:text=>sent.push(JSON.parse(text))},kill(){kills++;}};bridge.on('event',event=>events.push(event));
 bridge.receive({method:'item/started',params:{item:{type:'dynamicToolCall',tool:'list_mcp_resources',arguments:{}}}});
 bridge.receive({id:77,method:'item/tool/call',params:{tool:'list_mcp_resources',arguments:{}}});
 assert.equal(kills,0);assert(bridge.process);assert.equal(sent.length,1);assert.equal(sent[0].id,77);assert.equal(sent[0].result.success,false);assert.match(sent[0].result.contentItems[0].text,/no resource was read/);assert(!events.some(event=>event.method==='studio/codexDisconnected'));
 bridge.receive({method:'item/started',params:{item:{type:'imageView',path:'/ungranted'}}});assert.equal(kills,1);assert.equal(events.at(-1).params.code,'STUDIO_CODEX_UNSCOPED_TOOL');assert.equal(bridge.process,null);
});

for(const tool of ['list_mcp_resources','list_mcp_resource_templates'])for(const activity of [false,true])test('isolated '+tool+' '+(activity?'activity and request':'request only')+' reads no resource and preserves following protocol traffic',async()=>{
 const bridge=new CodexBridge({strictIsolation:true}),events=[],sent=[],reads=[];let kills=0;
 const child={stdin:{destroyed:false,write:text=>sent.push(JSON.parse(text))},kill(){kills++;}};bridge.process=child;bridge.on('event',event=>events.push(event));
 const readFile=fs.readFileSync,open=fs.openSync;
 try{
  fs.readFileSync=(...args)=>{reads.push(args);throw Error('Catalog rejection must not read a file');};fs.openSync=(...args)=>{reads.push(args);throw Error('Catalog rejection must not open a resource');};
  if(activity)bridge.receive({method:'item/started',params:{threadId:'thread',turnId:'turn',item:{id:'catalog-item',type:'dynamicToolCall',namespace:null,tool,arguments:{server:'outside',path:'/ungranted/private'}}}});
  bridge.receive({id:activity?'catalog-request':78,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'catalog-item',namespace:null,tool,arguments:{server:'outside',path:'/ungranted/private'}}});
  bridge.receive({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'catalog-item',type:'dynamicToolCall',namespace:null,tool,arguments:{},status:'completed',success:false}}});
 }finally{fs.readFileSync=readFile;fs.openSync=open;}
 assert.deepEqual(reads,[]);assert.equal(bridge.process,child);assert.equal(kills,0);assert.equal(sent.length,1);assert.equal(sent[0].id,activity?'catalog-request':78);assert.equal(sent[0].result.success,false);assert.equal(sent[0].result.contentItems[0].type,'inputText');assert.match(sent[0].result.contentItems[0].text,/unsupported.*no resource was read/);assert.equal(bridge.requests.size,0);assert(!events.some(event=>event.method==='studio/codexDisconnected'));
 bridge.receive({method:'turn/started',params:{threadId:'thread',turn:{id:'following-turn'}}});assert(bridge.activeTurns.has('thread'));
 bridge.receive({method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'following-turn',itemId:'reply',delta:'Following normal reply.'}});assert(events.some(event=>event.params?.delta==='Following normal reply.'));
 const pending=bridge.rawRequest('thread/read',{threadId:'thread'}),request=sent.at(-1);bridge.receive({id:request.id,result:{thread:{id:'thread',turns:[]}}});assert.equal((await pending).thread.id,'thread');assert.equal(bridge.process,child);
 bridge.receive({method:'turn/completed',params:{threadId:'thread',turn:{id:'following-turn'}}});assert.equal(bridge.activeTurns.size,0);assert.equal(bridge.pending.size,0);assert.equal(kills,0);
});

for(const tool of ['read_mcp_resource','list_mcp_resources_extra','List_mcp_resources','submit_run','arbitrary_native_tool'])for(const request of [false,true])test('strict isolation still denies unscoped dynamic '+tool+' '+(request?'request':'activity'),()=>{
 const bridge=new CodexBridge({strictIsolation:true}),events=[],sent=[];let kills=0;
 bridge.process={stdin:{destroyed:false,write:text=>sent.push(JSON.parse(text))},kill(){kills++;}};bridge.on('event',event=>events.push(event));
 bridge.receive(request?{id:79,method:'item/tool/call',params:{namespace:'gpusampling',tool,arguments:{}}}:{method:'item/started',params:{item:{type:'dynamicToolCall',namespace:'gpusampling',tool,arguments:{}}}});
 assert.equal(kills,1);assert.equal(bridge.process,null);assert.equal(sent.length,0);assert.equal(bridge.requests.size,0);assert.equal(events.at(-1).params.code,'STUDIO_CODEX_UNSCOPED_TOOL');
});

test('native gpusampling resource and template listings complete in the same isolated conversation',()=>{
 const bridge=new CodexBridge({strictIsolation:true}),events=[];
 const child={kill:()=>assert.fail('A query to the enabled server interrupted the conversation')};
 bridge.process=child;
 bridge.on('event',event=>events.push(event));
 const threadId='catalog-thread',turnId='catalog-turn';
 bridge.receive({method:'turn/started',params:{threadId,turn:{id:turnId}}});
 for(const [tool,key] of [['list_mcp_resources','resources'],['list_mcp_resource_templates','resourceTemplates']]){
  const item={id:tool,type:'mcpToolCall',server:'gpusampling',tool,arguments:{server:'gpusampling'}};
  bridge.receive({method:'item/started',params:{threadId,turnId,item:{...item,status:'inProgress'}}});
  const text=JSON.stringify({server:'gpusampling',[key]:[]});
  bridge.receive({method:'item/completed',params:{threadId,turnId,item:{...item,status:'completed',result:{content:[{type:'text',text}]}}}});
  const completed=events.at(-1);
  assert.equal(completed.method,'item/completed');
  assert.equal(completed.params.item.result.content[0].text,text);
 }
 bridge.receive({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
 assert.equal(bridge.process,child);
 assert.equal(bridge.activeTurns.size,0);
});

function activeCatalogConversation(){
 const bridge=new CodexBridge({strictIsolation:true}),messages=[];
 bridge.process={stdin:{write:line=>messages.push(JSON.parse(line))},kill(){}};
 bridge.isolation={worker:{}};bridge.isolationReady=true;
 bridge.receive({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});
 return {bridge,messages};
}

test('native aggregate discovery stays in its conversation and returns subsequent skill activity',()=>{
 const {bridge}=activeCatalogConversation(),events=[],child=bridge.process;
 bridge.on('event',event=>events.push(event));
 for(const tool of ['list_mcp_resources','list_mcp_resource_templates']){
  const item={id:tool,type:'mcpToolCall',server:'codex',tool,arguments:{}};
  bridge.receive({method:'item/started',params:{threadId:'thread',turnId:'turn',item}});
  bridge.receive({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{...item,status:'completed'}}});
 }
 bridge.receive({method:'item/started',params:{threadId:'thread',turnId:'turn',item:{type:'mcpToolCall',server:'gpusampling',tool:'read_scientific_skill'}}});
 assert.equal(bridge.process,child);assert.equal(events.at(-1).params.item.tool,'read_scientific_skill');
});

for(const [tool,field] of [['list_mcp_resources','resources'],['list_mcp_resource_templates','resourceTemplates']]){
 test('dynamic '+tool+' lists real entries from the active server and preserves cursors',async()=>{
  const {bridge,messages}=activeCatalogConversation();
  const row={name:'example',...(field==='resources'?{uri:'example://one'}:{uriTemplate:'example://{id}'})};
  bridge.rawRequest=async(method,params)=>{
   assert.equal(method,'mcpServerStatus/list');assert.deepEqual(params,{threadId:'thread',detail:'full',limit:100,cursor:'a'});
   return {data:[{name:'gpusampling',runtimeStatus:'connected',[field]:[row]},{name:'outside',[field]:[{name:'unrelated'}]}],nextCursor:'b'};
  };
  await bridge.answerResourceCatalog({id:77,params:{threadId:'thread',turnId:'turn',namespace:'functions',tool,arguments:{cursor:'a'}}});
  assert.equal(messages[0].result.success,true);
  assert.deepEqual(JSON.parse(messages[0].result.contentItems[0].text),{[field]:[{...row,server:'gpusampling'}],nextCursor:'b'});
 });
}

test('dynamic resource listing reports disconnection and discards a late result after a turn change',async()=>{
 const {bridge,messages}=activeCatalogConversation();
 const request={id:77,params:{threadId:'thread',turnId:'turn',tool:'list_mcp_resources',arguments:{server:'gpusampling'}}};
 bridge.rawRequest=async()=>({data:[{name:'gpusampling',runtimeStatus:'disconnected',resources:[]}]});
 await bridge.answerResourceCatalog(request);
 assert.equal(messages[0].result.success,false);
 bridge.rawRequest=async()=>{bridge.turnIds.set('thread','next');return {data:[]};};
 await bridge.answerResourceCatalog(request);
 assert.equal(messages[1].result.success,false);assert.match(messages[1].result.contentItems[0].text,/conversation changed/);
});

test('other server operations and malformed aggregate activity cannot use the catalog exemption',()=>{
 for(const [server,tool,args] of [['outside','list_mcp_resources',{}],['codex','read_mcp_resource',{}],['codex','list_mcp_resources',{server:'outside'}],['codex','list_mcp_resources',{path:'unrelated'}]]){
  const {bridge}=activeCatalogConversation();
  bridge.receive({method:'item/started',params:{threadId:'thread',turnId:'turn',item:{type:'mcpToolCall',server,tool,arguments:args}}});
  assert.equal(bridge.process,null);
 }
});

test('numeric .out selection preserves mapped paths and refuses private/ambiguous names',()=>{
 assert.deepEqual(explicitScientificInputs('Use "D:\\numeric data\\energy_test.out"'),['/mnt/d/numeric data/energy_test.out']);
 assert.deepEqual(explicitScientificInputs('Use /home/test/owned/energy_test.out\n/home/test/owned/force_test.out\n/home/test/owned/virial_test.out\n/home/test/owned/evaluation.json'),['/home/test/owned/energy_test.out','/home/test/owned/force_test.out','/home/test/owned/virial_test.out','/home/test/owned/evaluation.json']);
 for(const value of ['/private/skills/source.out','/home/test/owned/source.out.md','https://example.invalid/data.out'])assert.deepEqual(explicitScientificInputs(value),[]);
});

test('empty typed image IPC is explicit and unknown channels remain denied',async()=>{
 const exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(new URL("../../desktop/preload.cjs",import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{exposed[key]=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({status:'cancelled'});},on(){},removeListener(){}}};}});
 await exposed.studio.invoke('diagnostics.saveWorkbenchImage',{});
 assert.deepEqual(calls,[['studio:diagnostics.saveWorkbenchImage',{}]]);
 await assert.rejects(exposed.studio.invoke('diagnostics.captureDesktop',{}));
});

test('owned capture precedes dialog and cancellation writes nothing',async()=>{
 const f=imageFixture(),save=createWorkbenchImageExporter(f.options);
 assert.deepEqual(await save({},f.event),{status:'cancelled'});assert.deepEqual(f.calls,['capture','dialog']);
 for(const data of [null,false,[],{path:'/untrusted/output.png'}])await assert.rejects(save(data,f.event));
 await assert.rejects(save({},{}));assert.deepEqual(f.calls,['capture','dialog']);
});

test('geometry drift and closed owners cannot commit captured bytes',async()=>{
 for(const mode of ['geometry','close']){
  const f=imageFixture();f.options.showSaveDialog=async()=>{if(mode==='close')f.owner.emit('closed');else f.owner.getContentSize=()=>[17,12];return{canceled:false,filePath:path.resolve('never-written.png')};};
  await assert.rejects(createWorkbenchImageExporter(f.options)({},f.event));assert(!f.calls.includes('write'));
 }
});

test('malformed PNG and abnormal NativeImage geometry are rejected before dialog',async()=>{
 const f=imageFixture();assert.throws(()=>inspectPng(Buffer.from('not-png'),f.options.decodePng));
 f.image.getSize=()=>({width:1,height:1});await assert.rejects(createWorkbenchImageExporter(f.options)({},f.event));assert.deepEqual(f.calls,['capture']);
});

test('atomic PNG writer cleans only its own temporary file when final owner guard fails',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'studio-image-'));
 try{const destination=path.join(folder,'capture.png');let checks=0;assert.throws(()=>writePngAtomically(destination,Buffer.from('synthetic'),()=>{if(++checks===2)throw Error('Owner changed');}));assert.deepEqual(fs.readdirSync(folder),[]);}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('capture timeout ignores late image without opening dialog or writing',async()=>{
 const f=imageFixture();let release;f.contents.capturePage=()=>new Promise(resolve=>{release=resolve;});
 await assert.rejects(createWorkbenchImageExporter({...f.options,timeoutMs:1})({},f.event),/超时/);
 release(f.image);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls,[]);
});
