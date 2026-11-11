import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installDesktopShutdown} from '../../desktop/platform/desktop-shutdown.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fakeApp(){
 const app=new EventEmitter();app.allowed=0;app.attempts=0;
 app.quit=()=>{app.attempts++;const event={blocked:false,preventDefault(){this.blocked=true;}};app.emit('before-quit',event);if(!event.blocked)app.allowed++;};
 return app;
}
test('normal quit fences work synchronously and waits for connection cleanup',async()=>{
 const app=fakeApp(),order=[];let finish;
 const done=new Promise(resolve=>finish=resolve);
 installDesktopShutdown({app,begin:()=>order.push('closing'),cleanup:async()=>{order.push('cleanup');await done;order.push('closed');}});
 app.quit();assert.deepEqual(order,['closing']);assert.equal(app.allowed,0);
 await tick();assert.deepEqual(order,['closing','cleanup']);assert.equal(app.allowed,0);
 finish();await tick();assert.equal(app.allowed,1);assert.deepEqual(order,['closing','cleanup','closed']);
});
test('repeated quit requests share one cleanup and do not enter an exit loop',async()=>{
 const app=fakeApp();let starts=0,cleanups=0,finish;
 const done=new Promise(resolve=>finish=resolve);
 const api=installDesktopShutdown({app,begin:()=>starts++,cleanup:()=>{cleanups++;return done;}});
 app.quit();app.quit();const first=api.run(),second=api.run();assert.equal(first,second);
 await tick();assert.equal(starts,1);assert.equal(cleanups,1);assert.equal(app.allowed,0);
 finish();await first;await tick();assert.equal(cleanups,1);assert.equal(app.allowed,1);assert.equal(app.attempts,3);
});
test('cleanup rejection still completes a normal quit without leaking its error',async()=>{
 const app=fakeApp(),api=installDesktopShutdown({app,begin:()=>{},cleanup:async()=>{throw Error('private failure');}});
 app.quit();const result=await api.run();await tick();assert.deepEqual(result,{status:'unconfirmed'});assert.equal(app.allowed,1);
});
test('a stalled cleanup has a bounded quit and can settle later without another quit',async()=>{
 const app=fakeApp();let finish;
 const api=installDesktopShutdown({app,begin:()=>{},cleanup:()=>new Promise(resolve=>finish=resolve),timeoutMs:15});
 app.quit();assert.deepEqual(await api.run(),{status:'unconfirmed'});await tick();assert.equal(app.allowed,1);
 finish();await tick();assert.equal(app.allowed,1);
});
test('explicit application exit preparation uses the same cleanup exactly once',async()=>{
 const app=fakeApp();let cleanups=0;
 const api=installDesktopShutdown({app,begin:()=>{},cleanup:async()=>{cleanups++;}});
 assert.deepEqual(await api.run(),{status:'closed'});app.quit();assert.equal(cleanups,1);assert.equal(app.allowed,1);
});
test('an unconfirmed terminal shutdown remains unconfirmed to the caller',async()=>{
 const app=fakeApp(),api=installDesktopShutdown({app,begin:()=>{},cleanup:async()=>({status:'unconfirmed',unconfirmed:1})});
 assert.deepEqual(await api.run(),{status:'unconfirmed'});app.quit();assert.equal(app.allowed,1);
});
test('a connection continuation queued before quit already sees the synchronous terminal fence',async()=>{
 const app=fakeApp();let accepting=true,closing;
 const continuation=Promise.resolve().then(()=>assert.equal(accepting,false,'no queued open may enter after before-quit'));
 const api=installDesktopShutdown({app,begin:()=>{accepting=false;closing=Promise.resolve({status:'closed'});},cleanup:()=>closing});
 app.quit();await continuation;await api.run();await tick();assert.equal(app.allowed,1);
});
