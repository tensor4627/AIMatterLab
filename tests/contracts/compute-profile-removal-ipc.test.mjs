import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('preload exposes only the named saved-profile removal method and forwards the exact request',async()=>{
 const calls=[];let studio;const source=fs.readFileSync(new URL('../../desktop/preload.cjs',import.meta.url),'utf8');
 vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'studio');studio=value;}},ipcRenderer:{invoke:async(channel,data)=>{calls.push({channel,data});return {removed:true,id:data.id,version:data.expectedVersion};}}};}});
 const request={id:'00000000-0000-4000-8000-000000000001',expectedVersion:3},response=await studio.invoke('compute.profiles.remove',request);
 assert.equal(calls[0].channel,'studio:compute.profiles.remove');assert.equal(calls[0].data,request);assert.equal(response.removed,true);assert.equal(response.version,3);
 await assert.rejects(studio.invoke('compute.profiles.removeRemote',request),/Unsupported method/);assert.equal(calls.length,1);
});
