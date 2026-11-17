import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readSignedRelease,signingPayload,setupName,newerRelease} from '../../desktop/platform/update-release.mjs';
import {createWorkspaceUpdater} from '../../desktop/platform/workspace-updater.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const hash = bytes => createHash('sha512').update(bytes).digest('base64');
const signed = info => Buffer.from(JSON.stringify({...info,signature:sign('sha256',signingPayload(info),privateKey).toString('base64')}));
function blockmap(chunks) {
  return gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,sizes:chunks.map(c=>c.length),
    checksums:chunks.map(c=>createHash('sha256').update(c).digest().subarray(0,18).toString('base64'))}]}));
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'aimatterlab-updates-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const workspace={directory:root,cache:path.join(root,'user-cache')}, cache=path.join(workspace.cache,'updates');
  await fs.mkdir(cache,{recursive:true});
  const old=['base','old','tail'].map(c=>Buffer.from(c)), next=[old[2],Buffer.from('new'),old[0]];
  const bytes=Buffer.concat(next), oldMap=blockmap(old), newMap=blockmap(next), url=setupName('0.1.8');
  const info={version:'0.1.8',files:[{url,size:bytes.length,sha512:hash(bytes)}],path:url,sha512:hash(bytes),blockMap:{size:newMap.length,sha512:hash(newMap)}};
  await fs.writeFile(path.join(cache,'installer.exe'),Buffer.concat(old));
  const api={manifest:signed(info),badRange:false,offline:false,requests:[],states:[],installs:[],quits:0};
  async function fetchApi(url,{headers}) {
    api.requests.push({url,range:headers.Range});
    if(api.offline)throw Error('offline');
    if(url.endsWith('latest.yml'))return new Response(api.manifest);
    if(url.endsWith('.blockmap'))return new Response(url.includes('/v0.1.7/')?oldMap:newMap);
    if(!headers.Range||api.badRange)return new Response(bytes);
    const [,a,b]=headers.Range.match(/^bytes=(\d+)-(\d+)$/), start=Number(a),end=Number(b);
    return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});
  }
  function client() {
    return createWorkspaceUpdater({workspace,currentVersion:'0.1.7',fetchApi,decodeManifest:data=>readSignedRelease(data,publicKey),
      publish:s=>api.states.push(s),install:(...args)=>api.installs.push(args),quit:()=>api.quits++});
  }
  return {api,client,cache,bytes,workspace,info};
}

test('a signed stable release reconstructs from just the changed range, survives an offline restart and installs in the originating workspace',async t=>{
  const {api,client,cache,bytes,workspace}=await fixture(t), updater=client();
  const available=await updater.check();
  assert.equal(available.mode,'delta');assert.equal(available.bytes,3);
  const [a,b]=await Promise.all([updater.download(),updater.download()]);
  assert.equal(a.phase,'ready');assert.equal(b.phase,'ready');
  assert.deepEqual(await fs.readFile(path.join(cache,'pending.exe')),bytes);
  assert.deepEqual(api.requests.filter(v=>v.url.endsWith('.exe')).map(v=>v.range),['bytes=4-6']);
  assert.equal(api.quits,0);
  api.offline=true;
  const restarted=client();assert.equal((await restarted.check()).phase,'ready');
  await Promise.all([restarted.apply(),restarted.apply()]);
  assert.deepEqual(api.installs,[[path.join(cache,'pending.exe'),workspace.directory]]);assert.equal(api.quits,1);
});

test('failed range explicitly offers the full download, damaged pending data never launches',async t=>{
  const {api,client,cache,bytes}=await fixture(t), updater=client();
  await updater.check();api.badRange=true;
  const fallback=await updater.download();assert.equal(fallback.phase,'available');assert.equal(fallback.reason,'delta');
  assert.equal(api.requests.filter(v=>v.url.endsWith('.exe')&&!v.range).length,0);
  assert.equal((await updater.download()).phase,'ready');
  await fs.writeFile(path.join(cache,'pending.exe'),Buffer.alloc(bytes.length));
  assert.equal((await updater.apply()).phase,'available');assert.equal(api.quits,0);
  assert.equal((await updater.download()).phase,'ready');assert.deepEqual(await fs.readFile(path.join(cache,'pending.exe')),bytes);
});

test('a cleared base offers the full installer and a partial download is removed on startup',async t=>{
  const {api,client,cache}=await fixture(t);
  await fs.unlink(path.join(cache,'installer.exe'));await fs.writeFile(path.join(cache,'download.part'),'interrupted');
  const updater=client();assert.equal((await updater.check()).reason,'base');
  await assert.rejects(fs.stat(path.join(cache,'download.part')),{code:'ENOENT'});
  assert.equal((await updater.download()).phase,'ready');assert.equal(api.requests.filter(v=>v.range).length,0);
});

test('a modified manifest and an unrelated signer are rejected before any binary request',async t=>{
  const {api,client,info}=await fixture(t);
  assert.throws(()=>readSignedRelease(api.manifest),/signature/);
  const changed=JSON.parse(api.manifest);changed.files[0].size++;
  api.manifest=Buffer.from(JSON.stringify(changed));
  assert.equal((await client().check()).phase,'error');assert.equal(api.requests.length,1);
  assert.throws(()=>signingPayload({...info,files:[{...info.files[0],url:'https://example.com/setup.exe'}]}));
  assert.equal(newerRelease('0.1.8','0.1.8-rc.1'),true);assert.equal(newerRelease('0.1.8','0.1.9'),false);
});

test('a same-size damaged base offers the signed full package without replacing the running installation',async t=>{
  const {api,client,cache}=await fixture(t), updater=client();
  await updater.check();
  await fs.writeFile(path.join(cache,'installer.exe'),Buffer.alloc(11));
  const state=await updater.download();assert.equal(state.reason,'delta');assert.equal(state.phase,'available');
  await assert.rejects(fs.stat(path.join(cache,'pending.exe')),{code:'ENOENT'});
  assert.equal(api.installs.length,0);assert.equal((await updater.download()).phase,'ready');
});

test('a linked update directory is rejected before any network request or cleanup',async t=>{
  const {api,client,cache}=await fixture(t), other=cache+'-other';
  await fs.rename(cache,other);await fs.symlink(other,cache,process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(other,'download.part'),'outside');
  assert.equal((await client().check()).phase,'error');assert.equal(api.requests.length,0);
  assert.equal(await fs.readFile(path.join(other,'download.part'),'utf8'),'outside');
});
