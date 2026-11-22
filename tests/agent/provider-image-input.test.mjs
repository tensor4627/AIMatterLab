import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createChatAttachments} from '../../agent/sessions/chat-attachments.mjs';
import {chatAttachmentRefs} from '../../contracts/agent/chat-attachments.mjs';
import {CodexBridge} from '../../agent/providers/codex.mjs';
import {AcpBridge} from '../../agent/providers/acp.mjs';
import {constrainedRequest} from '../../desktop/platform/codex-isolation.mjs';
import {ATTACHMENT_FRAME_BYTES,createJsonlFramer} from '../../agent/providers/jsonl-frames.mjs';

const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWM4ZhAJAAMPAVB8H27FAAAAAElFTkSuQmCC','base64');
const sessionId='fixture-chat';
function attachment(provider){
 const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'studio-provider-image-'));
 assert.equal(path.dirname(root),parent);
 const catalog=new Catalog(root),attachments=createChatAttachments({catalog}),owner={provider,threadId:sessionId};
 try{
  const [file]=attachments.stage({...owner,files:[{name:'figure.png',size:bytes.length,mimeType:'image/png',bytes}]});
  const [metadata,image]=attachments.inputs(owner,[file.id]);
  return {file,metadata,image};
 }finally{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});}
}

test('strict Codex start only forwards a main-sealed image and strips echoed bytes from all public receipts',async t=>{
 const {file,metadata,image}=attachment('codex');
 const turns=[],events=[];
 const bridge=new CodexBridge({strictIsolation:true,host:{constrainedRequest,verifyIsolation:async()=>({})}});
 t.after(()=>bridge.close());
 bridge.isolation={cwd:path.resolve('fixture-owned-cwd')};
 bridge.isolationReady=true;
 bridge.on('event',event=>events.push(event));
 let item;
 bridge.process={stdin:{write(line){
  const request=JSON.parse(line);turns.push(request);
  if(request.method==='turn/start'){
   item={id:'native-image-item',clientId:'fixture-client',type:'userMessage',content:[
    ...request.params.input,{type:'localImage',path:'fixture-unshared-path'}
   ]};
   bridge.receive({method:'item/completed',params:{threadId:sessionId,turnId:'turn',item}});
  }
  const turn={id:'turn',items:[item]};
  bridge.receive({id:request.id,result:request.method==='turn/start'?{turn}:{thread:{id:sessionId,turns:[turn]}}});
 }},kill(){}};
 const input=[{type:'text',text:'Inspect fixture figure.'},metadata,image];
 for(const invalid of [structuredClone(image),{type:'image',url:'https://fixture.invalid/image'},{type:'image',fileId:'fixture-file'},{type:'localImage',path:'fixture-private-file'}]){
  await assert.rejects(bridge.request('turn/start',{threadId:sessionId,input:[invalid]}),/main-authorized/);
 }
 await assert.rejects(bridge.request('turn/steer',{threadId:sessionId,expectedTurnId:'turn',input:[image]}),/main-authorized/);
 assert.equal(turns.length,0);
 const started=await bridge.request('turn/start',{threadId:sessionId,input});
 assert.deepEqual(turns[0].params.input,[input[0],metadata,{type:'image',url:'data:image/png;base64,'+bytes.toString('base64')}]);
 assert.deepEqual(turns[0].params.sandboxPolicy,{type:'readOnly',networkAccess:false});
 const publicItem=started.turn.items[0],eventItem=events.find(event=>event.method==='item/completed').params.item;
 assert.equal(publicItem.id,'native-image-item');
 assert.equal(publicItem.clientId,'fixture-client');
 assert.deepEqual(publicItem.content,[input[0],metadata]);
 assert.deepEqual(eventItem,publicItem);
 assert.deepEqual(chatAttachmentRefs(publicItem.content),[file]);
 const loaded=await bridge.request('thread/read',{threadId:sessionId,includeTurns:true});
 assert.deepEqual(loaded.thread.turns[0].items,[publicItem]);
});

test('Kimi ACP sends a sealed image only when initialized with image capability and retains its text metadata',async t=>{
 const {file,metadata,image}=attachment('kimi'),sent=[];
 const bridge=new AcpBridge('kimi');
 t.after(()=>bridge.close());
 const models={currentModelId:'kimi-fixture',availableModels:[{modelId:'kimi-fixture',name:'Kimi Fixture'}]};
 bridge.info={agentCapabilities:{loadSession:true,promptCapabilities:{image:false}}};
 bridge.profile={cwd:path.resolve('fixture-owned-cwd')};
 bridge.process={stdin:{write(line){sent.push(JSON.parse(line));}},kill(){}};
 bridge.sessions.set(sessionId,{id:sessionId,turns:[],tools:new Map(),models});
 bridge.current=sessionId;
 const input=[{type:'text',text:'Describe the attached fixture.'},metadata,image];
 assert.deepEqual((await bridge.request('model/list')).data[0].inputModalities,['text']);
 await assert.rejects(bridge.request('turn/start',{threadId:sessionId,input}),/只接受文字/);
 bridge.info.agentCapabilities.promptCapabilities.image=true;
 assert.deepEqual((await bridge.request('model/list')).data[0].inputModalities,['text','image']);
 await assert.rejects(bridge.request('turn/start',{threadId:sessionId,input:[structuredClone(image)]}),/选取的图片/);
 assert.equal(sent.length,0);
 const started=await bridge.request('turn/start',{threadId:sessionId,input,clientUserMessageId:'fixture-client'});
 const [{id,method,params}]=sent;
 assert.equal(method,'session/prompt');
 assert.deepEqual(params,{sessionId,prompt:[input[0],metadata,{type:'image',mimeType:'image/png',data:bytes.toString('base64')}]});
 bridge.receive({id,result:{stopReason:'end_turn'}});
 await new Promise(resolve=>setImmediate(resolve));
 const live=(await bridge.request('thread/read',{threadId:sessionId})).thread.turns[0];
 assert.equal(live.id,started.turn.id);
 assert.equal(live.items[0].clientUserMessageId,'fixture-client');
 assert.deepEqual(live.items[0].content,[input[0],metadata]);
 assert.deepEqual(chatAttachmentRefs(live.items[0].content),[file]);
 const resumed=bridge.request('thread/resume',{threadId:sessionId});
 assert.equal(sent.at(-1).method,'session/load');
 for(const content of params.prompt)bridge.receive({method:'session/update',params:{sessionId,update:{sessionUpdate:'user_message_chunk',messageId:'replayed-user',content:content.type==='text'?{...content,text:content.text+'\n'}:content}}});
 bridge.receive({id:sent.at(-1).id,result:{models}});
 const replay=(await resumed).thread.turns[0].items[0];
 assert.match(replay.text,/Describe the attached fixture/);
 assert.deepEqual(chatAttachmentRefs(replay.content),[file]);
 assert.equal(JSON.stringify(replay).includes(bytes.toString('base64')),false);
});

test('JSONL framing handles a full attachment-sized frame split across child chunks',()=>{
 const frames=[],length=4*Math.ceil((16*1024*1024)/3);
 const head='{"data":"',suffix='"}',block=Buffer.alloc(65536,'x');
 const framer=createJsonlFramer({maxBytes:ATTACHMENT_FRAME_BYTES,onFrame:frame=>frames.push(frame),onOversize:bytes=>assert.fail('unexpected limit at '+bytes)});
 framer.feed(Buffer.from(head));
 for(let offset=0;offset<length;offset+=block.length)framer.feed(block.subarray(0,Math.min(length-offset,block.length)));
 framer.feed(Buffer.from(suffix+'\n{"next":true}\n'));
 assert.equal(frames[0].length,head.length+length+suffix.length);
 assert.equal(frames[0].slice(-4),'xx"}');
 assert.equal(frames[1],'{"next":true}');
 assert.equal(framer.bufferedBytes,0);
});
