import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {CodexBridge} from '../desktop/codex.mjs';
import {explicitScientificInputs} from '../desktop/task-authoring.mjs';
import {createWorkbenchImageExporter,writePngAtomically,inspectPng} from '../desktop/workbench-image.mjs';

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

test('unscoped Codex event fails closed once with safe tool diagnostic',()=>{
 const bridge=new CodexBridge({strictIsolation:true}),events=[];let kills=0;
 bridge.process={kill(){kills++;}};bridge.on('event',e=>events.push(e));
 bridge.receive({method:'item/started',params:{item:{type:'dynamicToolCall',tool:'list_mcp_resources',arguments:{}}}});
 assert.equal(kills,1);assert.equal(events.length,1);assert.equal(events[0].params.tool,'list_mcp_resources');assert.equal(events[0].params.code,'STUDIO_CODEX_UNSCOPED_TOOL');
 bridge.close();assert.equal(events.length,1);assert.equal(bridge.process,null);
});

test('numeric .out selection preserves mapped paths and refuses private/ambiguous names',()=>{
 assert.deepEqual(explicitScientificInputs('Use "D:\\numeric data\\energy_test.out"'),['/mnt/d/numeric data/energy_test.out']);
 assert.deepEqual(explicitScientificInputs('Use /home/test/owned/energy_test.out\n/home/test/owned/force_test.out\n/home/test/owned/virial_test.out\n/home/test/owned/evaluation.json'),['/home/test/owned/energy_test.out','/home/test/owned/force_test.out','/home/test/owned/virial_test.out','/home/test/owned/evaluation.json']);
 for(const value of ['/private/skills/source.out','/home/test/owned/source.out.md','https://example.invalid/data.out'])assert.deepEqual(explicitScientificInputs(value),[]);
});

test('empty typed image IPC is explicit and unknown channels remain denied',async()=>{
 const exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{exposed[key]=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({status:'cancelled'});},on(){},removeListener(){}}};}});
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
