/** Detached local terminal daemon. First stdin line is the only initialization channel. */
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createTerminalSession,TerminalFault,exact} from './session.mjs';
import {createSshConnections} from './ssh-connection.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateInitialization(value){exact(value,['controlToken','instanceId','runtimeRoot','dependencyRoot','port'],['controlToken','instanceId','runtimeRoot','dependencyRoot']);if(typeof value.controlToken!=='string'||! /^[a-f0-9]{64}$/.test(value.controlToken)||typeof value.instanceId!=='string'||!UUID.test(value.instanceId)||typeof value.runtimeRoot!=='string'||!path.isAbsolute(value.runtimeRoot)||value.runtimeRoot.length>4096||/[\0\r\n]/.test(value.runtimeRoot)||typeof value.dependencyRoot!=='string'||!path.isAbsolute(value.dependencyRoot)||value.dependencyRoot.length>4096||/[\0\r\n]/.test(value.dependencyRoot)||value.port!==undefined&&(!Number.isInteger(value.port)||value.port<0||value.port>65535))throw new TerminalFault('invalid_initialization');return structuredClone(value);}
export function readInitialization(input){return new Promise((resolve,reject)=>{let pending=Buffer.alloc(0),done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);input.off('data',data);input.off('end',end);input.off('error',errorHandler);input.on('error',()=>{});input.resume();error?reject(error):resolve(value);};const data=chunk=>{if(pending.length+chunk.length>16385)return finish(new TerminalFault('invalid_initialization'));pending=Buffer.concat([pending,Buffer.from(chunk)]);const newline=pending.indexOf(10);if(newline<0){if(pending.length>16384)finish(new TerminalFault('invalid_initialization'));return;}if(newline>16384||pending.subarray(newline+1).toString().trim())return finish(new TerminalFault('invalid_initialization'));try{finish(null,validateInitialization(JSON.parse(pending.subarray(0,newline).toString('utf8'))));}catch{finish(new TerminalFault('invalid_initialization'));}};const end=()=>finish(new TerminalFault('invalid_initialization')),errorHandler=()=>finish(new TerminalFault('invalid_initialization')),timer=setTimeout(()=>finish(new TerminalFault('initialization_timeout')),10000);input.on('data',data);input.on('end',end);input.on('error',errorHandler);});}
const failure=(code,status=400)=>{throw new TerminalFault(code,status);};
async function readBody(request,limit=65536){let size=0,parts=[];for await(const part of request){size+=part.length;if(size>limit)failure('request_too_large',413);parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{failure('invalid_request');}}
function authenticated(value,token){if(typeof value!=='string'||!value.startsWith('Bearer '))return false;const provided=Buffer.from(value.slice(7)),expected=Buffer.from(token);return provided.length===expected.length&&timingSafeEqual(provided,expected);}
export async function startBroker(initialization,{pty,now=Date.now,onShutdown=()=>{},serviceTimeouts,multiplexHost,connectionSessionFactory}={}){
 const config=validateInitialization(initialization);if(!pty){try{const dependency=createRequire(path.join(config.dependencyRoot,'runtime.cjs')),resolved=dependency.resolve('@lydell/node-pty'),relative=path.relative(path.join(config.dependencyRoot,'node_modules'),resolved);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error();pty=dependency('@lydell/node-pty');}catch{failure('pty_unavailable',503);}}
 const sessions=new Map(),connections=createSshConnections({pty,sessions,now,host:multiplexHost,serviceTimeouts,sessionFactory:connectionSessionFactory});let origin,stopping=false;const safeHealth=()=>({instanceId:config.instanceId,pid:process.pid});
 const server=http.createServer(async(request,response)=>{const send=(status,value)=>{if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};try{
  if(stopping)failure('service_stopping',503);
  if(request.headers.host!==new URL(origin).host||request.headers.origin!==undefined||request.socket.remoteAddress!=='127.0.0.1'||!authenticated(request.headers.authorization,config.controlToken))failure('unauthorized',403);
  if(typeof request.url!=='string'||request.url.includes('?')||request.url.includes('#'))failure('invalid_route');
  if(request.method==='GET'&&request.url==='/health')return send(200,safeHealth());
  if(request.method==='GET'&&request.url==='/sessions')return send(200,{sessions:[...sessions.values()].map(s=>s.state())});
  if(request.method==='GET'&&request.url==='/connections')return send(200,connections.list());
  const loginStatusRoute=/^\/connections\/([0-9a-f-]{36})\/login\/status\/([A-Za-z0-9_-]{1,100})$/.exec(request.url);
  if(loginStatusRoute){if(request.method!=='GET')failure('invalid_method',405);return send(200,connections.loginStatus({connectionId:loginStatusRoute[1],requestId:loginStatusRoute[2]}));}
  if(request.method!=='POST'&&request.method!=='GET')failure('invalid_method',405);
  const connectionRoute=/^\/connections\/([0-9a-f-]{36})\/(state|confirm|login\/complete|auth\/read|auth\/input|auth\/resize|shell\/open|workspace(?:\/command)?|close|managed-shell\/(?:open|state|read|input|close)|service\/(?:start|state|request|private-request|stop|cancel))$/.exec(request.url),connectionOpen=request.url==='/connections/open',profileRoute=/^\/connections\/profile\/(prepare|commit|abort)$/.exec(request.url);
  if(connectionRoute||connectionOpen||profileRoute){
   if(request.method==='GET'){if(!connectionRoute||!['state','service/state'].includes(connectionRoute[2]))failure('invalid_method',405);return send(200,await connections[connectionRoute[2]==='state'?'state':'serviceState']({connectionId:connectionRoute[1]}));}
   if(request.headers['content-type']!=='application/json')failure('invalid_content_type',415);
   const operation=connectionRoute?.[2],value=await readBody(request,operation==='service/start'?24*1024*1024:/^service\/(?:private-)?request$/.test(operation)?8*1024*1024:65536);if(stopping)failure('service_stopping',503);
   if(connectionOpen)return send(200,await connections.open(value));
   if(profileRoute)return send(200,await connections[{prepare:'prepareProfileUpdate',commit:'commitProfileUpdate',abort:'abortProfileUpdate'}[profileRoute[1]]](value));
   if(Object.hasOwn(value,'connectionId'))failure('invalid_request');
   if(operation.startsWith('managed-shell/'))return send(200,await connections.managedShell({connectionId:connectionRoute[1],...value},operation.slice(14)));
   const method={state:'state',confirm:'confirm','login/complete':'completeLogin','auth/read':'authRead','auth/input':'authInput','auth/resize':'authResize','shell/open':'openShell',workspace:'workspace','workspace/command':'runWorkspaceCommand',close:'close','service/start':'openService','service/state':'serviceState','service/request':'serviceRequest','service/private-request':'privateServiceRequest','service/stop':'closeService','service/cancel':'cancelServiceStart'}[operation];
   return send(200,await connections[method]({connectionId:connectionRoute[1],...value}));
  }
  const sessionRoute=/^\/sessions\/([0-9a-f-]{36})\/(state|read|input|owner|resize|close|service\/(?:start|request|stop|cancel|state))$/.exec(request.url),isOpen=request.url==='/sessions/open',isShutdown=request.url==='/shutdown';
  if(!sessionRoute&&!isOpen&&!isShutdown)failure('not_found',404);
  if(request.method==='GET'){if(!sessionRoute||!['state','service/state'].includes(sessionRoute[2]))failure('invalid_method',405);const session=sessions.get(sessionRoute[1]);if(!session)failure('session_not_found',404);return send(200,sessionRoute[2]==='state'?session.state():session.serviceState());}
  if(request.headers['content-type']!=='application/json')failure('invalid_content_type',415);
  const operation=sessionRoute?.[2],value=await readBody(request,operation==='service/start'?24*1024*1024:operation==='service/request'?8*1024*1024:65536);if(stopping)failure('service_stopping',503);
  if(isOpen){if(sessions.size>=4)failure('session_limit',409);const session=createTerminalSession({pty,plan:value,now,serviceTimeouts});sessions.set(session.state().id,session);return send(200,session.state());}
  if(isShutdown){exact(value,[]);send(200,{stopped:true});await close();onShutdown();return;}
  const session=sessions.get(sessionRoute[1]);if(!session)failure('session_not_found',404);if(['state','service/state'].includes(operation))failure('invalid_method',405);
  if(operation.startsWith('service/')){const method={start:'serviceStart',request:'serviceRequest',stop:'serviceStop',cancel:'serviceCancelStart'}[operation.slice(8)];let result;try{result=await session[method](value);}catch(error){
   // V2 startup has a bounded, sanitized diagnostic state. A lost/unknown
   // bootstrap still owns the private lane; returning that fact must not
   // disguise it as a dead broker or trigger another SSH/bootstrap attempt.
   if(operation==='service/start'&&value.bootstrap?.transport&&error instanceof TerminalFault&&['service_start_unknown','python_response_timeout','service_protocol_failed','service_transport_unknown','service_remote_failed','service_stop_unknown'].includes(error.code)&&session.serviceState().serviceStatus==='failed')result=session.serviceState();else throw error;
  }if(stopping)failure('service_stopping',503);return send(200,operation==='service/request'?result:{...session.serviceState(),...operation==='service/cancel'?{cancelled:true,cancelledRequestId:value.requestId}:{}});}
  const result=['input','resize','owner','close'].includes(operation)?await connections.withShell(sessionRoute[1],()=>session[operation](value)):operation==='read'&&value.waitMs!==undefined?await session.waitRead(value):session[operation](value);if(operation==='close')sessions.delete(sessionRoute[1]);send(200,result);
 }catch(error){send(error instanceof TerminalFault?error.status:400,{error:error instanceof TerminalFault?error.code:'request_rejected'});}});
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.on('clientError',(_error,socket)=>socket.destroy());
 async function close(){if(stopping)return;stopping=true;await connections.closeAll();for(const session of sessions.values())try{session.dispose();}catch{}sessions.clear();await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();});}
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port??0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return{ready:{origin,...safeHealth()},close};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{if(process.argv.length!==2)failure('invalid_initialization');const config=await readInitialization(process.stdin),broker=await startBroker(config,{onShutdown:()=>process.exit(0)});process.stdout.write(JSON.stringify(broker.ready)+'\n');process.on('SIGTERM',()=>void broker.close());process.on('SIGINT',()=>void broker.close());}catch{process.stderr.write('terminal_service_initialization_failed\n');process.exitCode=1;}
}
