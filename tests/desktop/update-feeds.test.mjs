import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateAccess,createUpdateFeeds} from '../../desktop/platform/update-feeds.mjs';

function feeds(fetchApi) {
  return createUpdateFeeds({fetchApi,tokenFor:source=>source+'-fixture',signal:new AbortController().signal});
}

test('GitLab direct release paths keep the token on the original host and preserve Range on storage redirects',async()=>{
  const calls=[];
  const sources=feeds((url,options)=>{
    calls.push({url,...options});
    if(calls.length===1)return Response.redirect('https://git.nju.edu.cn/api/v4/projects/123/packages/generic/app/1.2.3/file',302);
    if(calls.length===2)return Response.redirect('https://storage.example.org/file',307);
    return new Response('bytes',{status:206});
  });
  assert.equal((await sources.asset('nju','1.2.3','setup.exe',{Range:'bytes=0-4'})).status,206);
  assert.match(calls[0].url,/Tensor4627%2FAIMatterLab\/releases\/v1\.2\.3\/downloads\/setup\.exe$/);
  assert.deepEqual(calls.map(c=>c.headers['PRIVATE-TOKEN']),['nju-fixture','nju-fixture',undefined]);
  assert.ok(calls.every(c=>c.redirect==='manual'&&c.credentials==='omit'&&c.headers.Range==='bytes=0-4'&&!c.url.includes('fixture')));
});

test('authenticated GitHub uses release asset IDs and cached metadata, stripping authorization at the CDN',async()=>{
  const calls=[];
  const sources=feeds((url,options)=>{
    calls.push({url,...options});
    if(url.endsWith('/latest'))return Response.json({tag_name:'v1.2.3',assets:[{id:10,name:'latest.yml'},{id:11,name:'setup.exe'}]});
    if(url.includes('/assets/'))return Response.redirect('https://release-assets.githubusercontent.com/file',302);
    return new Response('ok');
  });
  await sources.asset('github',null,'latest.yml');
  await sources.asset('github','1.2.3','setup.exe',{Range:'bytes=0-10'});
  assert.equal(calls.length,5);assert.equal(calls[0].headers.Authorization,'Bearer github-fixture');
  assert.match(calls[1].url,/assets\/10$/);assert.match(calls[3].url,/assets\/11$/);
  assert.equal(calls[3].headers.Accept,'application/octet-stream');assert.equal(calls[4].headers.Range,'bytes=0-10');
  assert.ok(calls.filter(c=>c.url.includes('githubusercontent')).every(c=>!c.headers.Authorization));
  assert.equal((await sources.asset('github','1.2.3','missing')).status,404);
});

test('unsafe redirects are rejected before a second request',async()=>{
  let requests=0;
  const sources=feeds(()=>{requests++;return Response.redirect('http://storage.example.org/file',302);});
  await assert.rejects(sources.asset('nju',null,'latest.yml'),/Invalid update redirect/);
  assert.equal(requests,1);
});

test('credential IPC validation scopes each token to one host and returns only presence flags',()=>{
  const data=new Map(),vault={has:key=>data.has(key),put:(key,v)=>data.set(key,v),get:key=>data.get(key),remove:key=>data.delete(key)};
  const access=createUpdateAccess(vault);
  assert.deepEqual(access.save({source:'nju',token:'test-only'}),{nju:true,github:false});
  assert.equal(access.token('nju'),'test-only');assert.equal(access.token('github'),undefined);
  for(const input of [{source:'other',token:'x'},{source:'nju',token:'x\ny'},{source:'nju',token:42},{source:'nju',token:'x',url:'https://example.org'}])
    assert.throws(()=>access.save(input));
  assert.deepEqual(access.save({source:'nju',token:null}),{nju:false,github:false});
});
