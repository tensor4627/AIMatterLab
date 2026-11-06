// Official CLI integration against local model/MCP fixtures; this is not model-access evidence.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {AcpBridge} from "../agent/providers/acp.mjs";
import {prepareProfile} from '../desktop/platform/provider-runtime.mjs';
let active,attempt=0;const calls=[],models=[],requests=[];
const server=http.createServer(async(req,res)=>{
 let body='';for await(const part of req)body+=part;const value=body?JSON.parse(body):{};
 requests.push({provider:active,url:req.url,method:value.method});
 const json=data=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url==='/mcp'){
  if(value.id===undefined){res.writeHead(202);res.end();return;}
  let result={};
  if(value.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'studio-fixture',version:'1'}};
  if(value.method==='tools/list')result={tools:[{name:'inspect_assets',description:'Read the infrastructure fixture marker.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
  if(value.method==='tools/call'){calls.push({provider:active,name:value.params.name});result={content:[{type:'text',text:'STUDIO_MCP_FIXTURE_OK'}]};}
  json({jsonrpc:'2.0',id:value.id,result});return;
 }
 if(req.method==='GET'){json({object:'list',data:[{id:'studio-fixture',object:'model',owned_by:'local-fixture'}]});return;}
 const tool=(value.tools||[]).find(t=>t.function?.name?.endsWith('inspect_assets'));
 models.push({provider:active,url:req.url,tools:(value.tools||[]).map(t=>t.function?.name).filter(Boolean)});
 const done=value.messages?.some(m=>m.role==='tool'),delta=done?{content:'STUDIO_ACP_TOOL_OK'}:tool?{tool_calls:[{index:0,id:'fixture-call-'+(++attempt),type:'function',function:{name:tool.function.name,arguments:'{}'}}]}:{content:'MCP_TOOL_UNAVAILABLE'};
 const finish=delta.tool_calls?'tool_calls':'stop';
 if(value.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const choice of [{delta,finish_reason:null},{delta:{},finish_reason:finish}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'studio-fixture',choices:[{index:0,...choice}]})+'\n\n');res.end('data: [DONE]\n\n');}
 else json({id:'fixture',object:'chat.completion',model:'studio-fixture',choices:[{index:0,message:{role:'assistant',...delta},finish_reason:finish}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const report={scope:'Official CLI + local synthetic model/MCP fixture only. No account/model-access verification or scientific jobs.',checks:{},modelPayloads:models,toolCalls:calls,requests};
try{
 for(const provider of ['kimi','qwen']){
  active=provider;const home=path.resolve('.studio/provider-fixture-'+Date.now()),profile=prepareProfile(home,provider,provider==='qwen'?{model:'studio-fixture',baseUrl:base+'/v1',apiKey:'sk-studio-local-fixture'}:null);
  if(provider==='kimi')fs.writeFileSync(path.join(profile.home,'config.toml'),'default_model = "studio-fixture"\n[providers.fixture]\ntype = "openai"\napi_key = "sk-studio-local-fixture"\nbase_url = "'+base+'/v1"\n[models.studio-fixture]\nprovider = "fixture"\nmodel = "studio-fixture"\nmax_context_size = 65536\n'+fs.readFileSync(path.join(profile.home,'config.toml'),'utf8'));
  const bridge=new AcpBridge(provider),events=[];
  bridge.on('event',event=>events.push(event));bridge.on('diagnostic',text=>process.stderr.write(provider+': '+text.slice(-500)));
  try{
   await bridge.start(path.resolve(provider==='kimi'?'node_modules/@moonshot-ai/kimi-code/dist/main.mjs':'node_modules/@qwen-code/qwen-code/cli-entry.js'),profile,{url:base,tokens:{mcp:'fixture-only-token'}});
   const thread=await bridge.request('thread/start');
   await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Call inspect_assets then print its marker.'}]});
   for(let i=0;i<180;i++){if(events.some(e=>e.method==='turn/completed'))break;await new Promise(r=>setTimeout(r,250));}
   const complete=events.find(e=>e.method==='turn/completed');
   const output=events.filter(e=>e.method==='item/agentMessage/delta').map(e=>e.params.delta).join('');
   const used=calls.some(c=>c.provider===provider);
   const toolEvent=events.find(e=>e.method==='item/completed'&&e.params.item.tool==='inspect_assets');
   const safe=models.filter(m=>m.provider===provider).every(m=>m.tools.every(t=>/inspect_assets|ask.?user.?question/i.test(t)));
   report.checks[provider]={status:complete?.params.turn.status,toolExecuted:used,onlyMcpAndQuestionTools:safe,normalizedToolResult:!!toolEvent&&JSON.stringify(toolEvent.params.item.result).includes('STUDIO_MCP_FIXTURE_OK'),outputMarker:output.includes('STUDIO_ACP_TOOL_OK')};
   if(!used||!safe||!toolEvent||!JSON.stringify(toolEvent.params.item.result).includes('STUDIO_MCP_FIXTURE_OK')||!output.includes('STUDIO_ACP_TOOL_OK'))throw Error(provider+' fixture tool integration failed');
   bridge.close();
   await bridge.start(path.resolve(provider==='kimi'?'node_modules/@moonshot-ai/kimi-code/dist/main.mjs':'node_modules/@qwen-code/qwen-code/cli-entry.js'),profile,{url:base,tokens:{mcp:'fixture-only-token'}});
   const resumed=await bridge.request('thread/resume',{threadId:thread.thread.id});
   report.checks[provider].restoredHistory=resumed.thread.turns.some(turn=>turn.items.some(item=>item.type==='agentMessage'&&item.text.includes('STUDIO_ACP_TOOL_OK')));
   if(!report.checks[provider].restoredHistory)throw Error(provider+' fixture history restore failed');
  }catch(error){report.checks[provider]={...report.checks[provider],error:error.message};process.exitCode=1;}
  finally{bridge.close();}
 }
}finally{server.closeAllConnections();server.close();const output=process.env.STUDIO_PROVIDER_FIXTURE_OUT||'.studio/validation/providers-fixture.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report.checks,null,2));}
