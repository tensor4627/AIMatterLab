import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {prepareSshServiceResources,prepareSshServiceResourcesAsync} from '../../backend/main/compute/ssh-service-resources.mjs';
import {spawn} from 'node:child_process';
test('resource preparation completes when its parent starts paused in an inspector',async()=>{
 const module=new URL('../../backend/main/compute/ssh-service-resources.mjs',import.meta.url).href;
 const script=`import(${JSON.stringify(module)}).then(async m=>{const r=await m.prepareSshServiceResourcesAsync(${JSON.stringify(path.resolve('backend/worker'))},{profileId:'owned-debugger-regression'});console.log('RESOURCE_WORKER_READY '+r.payload.files.length);}).catch(e=>{console.error(e.stack);process.exitCode=1;});`;
 const child=spawn(process.execPath,['--inspect-brk=127.0.0.1:0','-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='',socket,expired=false;
 const deadline=setTimeout(()=>{expired=true;socket?.close();child.kill();},10000);
 child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('RESOURCE_WORKER_READY'))socket?.close();});
 child.stderr.on('data',bytes=>{errors+=bytes;const endpoint=errors.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/)?.[0];if(endpoint&&!socket){socket=new WebSocket(endpoint);socket.addEventListener('error',()=>{});socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.runIfWaitingForDebugger'})));}});
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(expired,false,'worker must not inherit the parent debugger pause');assert.equal(code,0,errors);assert.match(output,/RESOURCE_WORKER_READY 138/);}finally{clearTimeout(deadline);socket?.close();if(child.exitCode===null)child.kill();}
});
test('SSH software resources prepare off main, coalesce identical requests and retain exact content identity',async()=>{
 const source=path.resolve('backend/worker'),settings={profileId:'owned-resource-fixture',transportSource:path.resolve('desktop/platform/terminal-service/python')};let ticks=0;
 const timer=setInterval(()=>ticks++,1);try{const first=prepareSshServiceResourcesAsync(source,settings),other=prepareSshServiceResourcesAsync(source,settings);assert.equal(first,other);assert.deepEqual(await first,prepareSshServiceResources(source,settings));assert(ticks>0,'main event loop remains responsive during preparation');}finally{clearInterval(timer);}
 await assert.rejects(prepareSshServiceResourcesAsync('relative-source',settings),/ssh_service_resources_invalid/);
});
