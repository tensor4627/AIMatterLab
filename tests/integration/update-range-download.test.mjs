import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {planBlocks} from '../../desktop/platform/update-blocks.mjs';
import {readSignedRelease,setupName,signingPayload} from '../../desktop/platform/update-release.mjs';
import {createWorkspaceUpdater} from '../../desktop/platform/workspace-updater.mjs';

const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const sha512 = bytes => createHash('sha512').update(bytes).digest('base64');
const localSize = 128 * 1024 + 1;
const changeSize = 64;

function blocks(items) {
  let offset = 0;
  return items.map(([key,length]) => {
    const block = {key,length,offset};
    offset += length;
    return block;
  });
}

function blockmap(chunks) {
  return gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,sizes:chunks.map(c => c.length),
    checksums:chunks.map(c => createHash('sha256').update(c).digest().subarray(0,18).toString('base64'))}]}));
}

function requestedRange(range, bytes) {
  const [,first,last] = range.match(/^bytes=(\d+)-(\d+)$/);
  const start = Number(first), end = Number(last);
  return {body:bytes.subarray(start,end + 1),contentRange:`bytes ${start}-${end}/${bytes.length}`};
}

function partial(range, body = range.body, contentRange = range.contentRange) {
  return new Response(body,{status:206,headers:{'Content-Range':contentRange}});
}

async function fixture(t, count, authenticated = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'aimatterlab-ranges-'));
  t.after(() => fs.rm(root,{force:true,recursive:true}));
  const workspace = {directory:root,cache:path.join(root,'user-cache')};
  const cache = path.join(workspace.cache,'updates');
  await fs.mkdir(cache,{recursive:true});
  const local = Array.from({length:count + 1},(_,i) => Buffer.alloc(localSize,i + 1));
  const old = [...local].reverse(), next = [];
  const ranges = [];
  for (let i = 0; i < count; i++) {
    next.push(local[i],Buffer.alloc(changeSize,70 + i));
    const start = (i + 1) * localSize + i * changeSize;
    ranges.push(`bytes=${start}-${start + changeSize - 1}`);
  }
  next.push(local.at(-1));
  const bytes = Buffer.concat(next), oldMap = blockmap(old), newMap = blockmap(next);
  const currentVersion = '0.1.7', version = '0.1.8', name = setupName(version);
  const oldMapName = setupName(currentVersion) + '.blockmap', mapName = name + '.blockmap';
  const info = {version,files:[{url:name,size:bytes.length,sha512:sha512(bytes)}],path:name,sha512:sha512(bytes),
    blockMap:{size:newMap.length,sha512:sha512(newMap)}};
  const signature = sign('sha256',signingPayload(info),privateKey).toString('base64');
  const manifest = Buffer.from(JSON.stringify({...info,signature}));
  await fs.writeFile(path.join(cache,'installer.exe'),Buffer.concat(old));
  const api = {requests:[],states:[]};
  async function fetchApi(address, options) {
    const url = new URL(address), {headers} = options;
    api.requests.push({url,...options});
    const override = await api.respond?.(url,headers);
    if (override) return override;
    if (url.hostname === 'api.github.com' && url.pathname.endsWith('/latest')) {
      return Response.json({tag_name:`v${version}`,assets:[{id:11,name:'latest.yml'},{id:12,name:mapName},{id:13,name}]});
    }
    if (url.hostname === 'api.github.com' && url.pathname.endsWith(`/tags/v${currentVersion}`)) {
      return Response.json({tag_name:`v${currentVersion}`,assets:[{id:14,name:oldMapName}]});
    }
    if (url.pathname.endsWith('/latest.yml') || url.pathname.endsWith('/assets/11')) return new Response(manifest);
    if (url.pathname.endsWith(`/${oldMapName}`) || url.pathname.endsWith('/assets/14')) return new Response(oldMap);
    if (url.pathname.endsWith(`/${mapName}`) || url.pathname.endsWith('/assets/12')) return new Response(newMap);
    return headers.Range ? partial(requestedRange(headers.Range,bytes)) : new Response(bytes);
  }
  const updater = createWorkspaceUpdater({workspace,currentVersion,fetchApi,
    tokenFor:source => authenticated ? `${source}-test-token` : null,
    publish:state => api.states.push(state),install:() => assert.fail('Unexpected installer launch'),quit:() => {},
    decodeManifest:data => readSignedRelease(data,publicKey)});
  return {api,updater,cache,bytes,local,ranges};
}

test('the delta plan merges scattered local blocks in small gaps and caps remote requests at 8 MiB',() => {
  const cap = 8 * 1024 * 1024;
  const before = blocks([['tail',3],['gap-a',32 * 1024],['wide-gap',localSize],['gap-b',96 * 1024]]);
  const after = blocks([['first',101],['gap-a',32 * 1024],['gap-b',96 * 1024],['second',201],
    ['wide-gap',localSize],['large',2 * cap + 7],['tail',3]]);
  const large = after[5].offset;
  assert.deepEqual(planBlocks(before,after),[
    {remote:true,start:0,length:101 + 128 * 1024 + 201},
    {remote:false,start:before[2].offset,length:localSize},
    {remote:true,start:large,length:cap},
    {remote:true,start:large + cap,length:cap},
    {remote:true,start:large + 2 * cap,length:7},
    {remote:false,start:0,length:3}
  ]);
});

test('five parallel ranges reuse one GitHub redirect and write the installer in destination order', {timeout:5000}, async t => {
  const {api,updater,cache,bytes,local,ranges} = await fixture(t,7);
  const firstWave = Promise.withResolvers(), sixth = Promise.withResolvers();
  let started = 0, active = 0, peak = 0;
  const completed = [];
  api.respond = async (url,headers) => {
    if (!headers.Range) return;
    if (url.hostname === 'github.com') return Response.redirect('https://release-assets.githubusercontent.com/fixture.exe?signature=test');
    assert.equal(url.hostname,'release-assets.githubusercontent.com');
    const index = started++;
    active++;
    peak = Math.max(peak,active);
    if (index === 0) {
      const output = await fs.readFile(path.join(cache,'download.part'));
      for (let i = 0; i < local.length; i++) {
        const position = i * (localSize + changeSize);
        assert.deepEqual(output.subarray(position,position + localSize),local[i]);
      }
    }
    if (started === 5) firstWave.resolve();
    if (started === 6) sixth.resolve();
    const range = requestedRange(headers.Range,bytes);
    return partial(range,new ReadableStream({async pull(controller) {
      await firstWave.promise;
      if (!index) await sixth.promise;
      controller.enqueue(range.body);
      controller.close();
      completed.push(index);
      active--;
    }}));
  };
  assert.equal((await updater.check()).bytes,changeSize * ranges.length);
  const ready = await updater.download();
  assert.equal(ready.phase,'ready');
  assert.equal(peak,5);
  assert.notEqual(completed[0],0);
  assert.deepEqual(await fs.readFile(path.join(cache,'pending.exe')),bytes);
  const requests = api.requests.filter(request => request.headers.Range);
  assert.equal(requests.filter(request => request.url.hostname === 'github.com').length,1);
  assert.deepEqual(requests.filter(request => request.url.hostname !== 'github.com').map(request => request.headers.Range).sort(),ranges.toSorted());
  assert.equal(ready.received,changeSize * ranges.length);
  assert.equal(ready.assembled,bytes.length);
});

test('an expired cached GitHub URL is refreshed before mirror fallback and never receives credentials',async t => {
  const {api,updater,bytes,ranges} = await fixture(t,2,true);
  let discoveries = 0;
  api.respond = (url,headers) => {
    if (!headers.Range) return;
    if (url.hostname === 'api.github.com') {
      assert.equal(url.pathname.split('/').at(-1),'13');
      return Response.redirect(`https://release-assets.githubusercontent.com/fixture.exe?signature=${++discoveries}`);
    }
    assert.equal(url.hostname,'release-assets.githubusercontent.com');
    if (url.searchParams.get('signature') === '1' && headers.Range === ranges[1]) return new Response(null,{status:403});
    return partial(requestedRange(headers.Range,bytes));
  };
  await updater.check();
  assert.equal((await updater.download()).phase,'ready');
  const requests = api.requests.filter(request => request.headers.Range);
  assert.deepEqual(requests.filter(request => request.url.hostname === 'api.github.com').map(request => request.headers.Authorization),
    ['Bearer github-test-token','Bearer github-test-token']);
  assert.deepEqual(requests.filter(request => request.url.hostname === 'release-assets.githubusercontent.com')
    .map(request => [request.url.searchParams.get('signature'),request.headers.Range,request.headers.Authorization,request.credentials]),
  [['1',ranges[0],undefined,'omit'],['1',ranges[1],undefined,'omit'],['2',ranges[1],undefined,'omit']]);
  assert.ok(requests.every(request => request.url.hostname !== 'git.nju.edu.cn'));
});

test('short and mismatched ranges are retried without double-counting progress',async t => {
  const {api,updater,cache,bytes} = await fixture(t,1);
  let attempts = 0;
  api.respond = (url,headers) => {
    if (!headers.Range) return;
    if (url.hostname === 'git.nju.edu.cn') return new Response(null,{status:503});
    const range = requestedRange(headers.Range,bytes);
    attempts++;
    if (attempts === 1) return partial(range,Buffer.alloc(range.body.length - 1,255));
    if (attempts === 2) return partial(range,range.body,`${range.contentRange}0`);
    return partial(range);
  };
  await updater.check();
  const ready = await updater.download();
  assert.equal(ready.phase,'ready');
  assert.equal(ready.received,changeSize);
  assert.equal(ready.assembled,bytes.length);
  assert.equal(attempts,3);
  assert.deepEqual(await fs.readFile(path.join(cache,'pending.exe')),bytes);
});

test('an overlong range or updater closure cancels outstanding response bodies and removes the partial installer', {timeout:5000}, async t => {
  for (const reason of ['length','close']) await t.test(reason,async subtest => {
    const {api,updater,cache,bytes,ranges} = await fixture(subtest,2);
    const started = Promise.withResolvers();
    let cancelled = 0;
    api.respond = (url,headers) => {
      if (!headers.Range) return;
      const range = requestedRange(headers.Range,bytes);
      if (headers.Range === ranges[0]) return partial(range,Buffer.concat([range.body,Buffer.from([0])]));
      started.resolve();
      return partial(range,new ReadableStream({cancel() { cancelled++; }}));
    };
    await updater.check();
    const pending = updater.download();
    await started.promise;
    if (reason === 'close') updater.close();
    const fallback = await pending;
    assert.equal(fallback.phase,'available');
    assert.equal(fallback.reason,'delta');
    assert.equal(cancelled,1);
    if (reason === 'length') assert.match(fallback.detail,/Unexpected extra installer bytes/);
    await assert.rejects(fs.stat(path.join(cache,'download.part')),{code:'ENOENT'});
    await assert.rejects(fs.stat(path.join(cache,'pending.exe')),{code:'ENOENT'});
  });
});

test('a full mirror attempt hashes only the bytes in its complete response',async t => {
  const {api,updater,cache,bytes} = await fixture(t,1);
  await fs.unlink(path.join(cache,'installer.exe'));
  api.respond = (url,headers) => url.hostname === 'github.com' && url.pathname.endsWith('.exe') && !headers.Range
    ? new Response(Buffer.alloc(changeSize,255)) : undefined;
  assert.equal((await updater.check()).mode,'full');
  const ready = await updater.download();
  assert.equal(ready.phase,'ready');
  assert.equal(ready.source,'nju');
  assert.equal(ready.received,bytes.length);
  assert.deepEqual(await fs.readFile(path.join(cache,'pending.exe')),bytes);
});
