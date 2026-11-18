import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeSubscriptionEnv,createCodexSubscriptionRuntime} from '../../desktop/platform/codex-subscription-runtime.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-env-')),source=path.join(root,'native'),home=path.join(root,'profile/provider-contexts/codex/subscription-home'),logs=[];fs.mkdirSync(source);fs.mkdirSync(home,{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,source,home,logs,options:{report:v=>logs.push(v)}};}
test('copies only env and preserves existing conversations, credentials, connections and run state',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.source,'.env'),'PRIVATE_ENV=fixture');
 for(const name of ['sessions','history.sqlite','config.toml','auth.json'])fs.writeFileSync(path.join(f.source,name),'native-'+name);
 const records=['sessions','history.sqlite','auth.json','connections.json','runs.json'];
 for(const name of records)fs.writeFileSync(path.join(f.home,name),'existing-'+name);
 initializeSubscriptionEnv(f.home,f.source,f.options);
 assert.equal(fs.readFileSync(path.join(f.home,'.env'),'utf8'),'PRIVATE_ENV=fixture');
 assert.deepEqual(fs.readdirSync(f.home).sort(),['.env','.env-initialized',...records].sort());
 for(const name of records)assert.equal(fs.readFileSync(path.join(f.home,name),'utf8'),'existing-'+name);
 assert.match(f.logs[0],/已复制/);assert(f.logs[0].includes(path.join(f.home,'.env')));assert(!f.logs.join('').includes('PRIVATE_ENV'));
 fs.writeFileSync(path.join(f.source,'.env'),'changed');initializeSubscriptionEnv(f.home,f.source,f.options);
 assert.equal(f.logs.length,1);assert.equal(fs.readFileSync(path.join(f.home,'.env'),'utf8'),'PRIVATE_ENV=fixture');
 fs.unlinkSync(path.join(f.home,'.env'));initializeSubscriptionEnv(f.home,f.source,f.options);assert(!fs.existsSync(path.join(f.home,'.env')));
});
test('missing source reports actual target and is not retried on later startup',t=>{
 const f=fixture(t);initializeSubscriptionEnv(f.home,f.source,f.options);assert.match(f.logs[0],/未找到.*自行复制到/);assert(f.logs[0].includes(path.join(f.home,'.env')));
 fs.writeFileSync(path.join(f.source,'.env'),'late');initializeSubscriptionEnv(f.home,f.source,f.options);assert.equal(f.logs.length,1);assert(!fs.existsSync(path.join(f.home,'.env')));
});
test('copy and source inspection failures are distinct from missing and never leak error details',t=>{
 for(const operation of ['copyFileSync','statSync']){const f=fixture(t);fs.writeFileSync(path.join(f.source,'.env'),'secret');const files={...fs,[operation](){throw Object.assign(Error('secret'),{code:'EACCES'});}};
 initializeSubscriptionEnv(f.home,f.source,{...f.options,files});assert.match(f.logs[0],/复制失败.*EACCES/);assert(!f.logs[0].includes('未找到'));assert(!f.logs[0].includes('secret'));assert(f.logs[0].includes(path.join(f.home,'.env')));}
});
test('existing target and a target created concurrently are never overwritten',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.source,'.env'),'source');fs.writeFileSync(path.join(f.home,'.env'),'target');initializeSubscriptionEnv(f.home,f.source,f.options);assert.equal(fs.readFileSync(path.join(f.home,'.env'),'utf8'),'target');assert.deepEqual(f.logs,[]);
 const g=fixture(t);fs.writeFileSync(path.join(g.source,'.env'),'source');initializeSubscriptionEnv(g.home,g.source,{...g.options,files:{...fs,copyFileSync(source,target,flags){fs.writeFileSync(target,'concurrent');fs.copyFileSync(source,target,flags);}}});assert.equal(fs.readFileSync(path.join(g.home,'.env'),'utf8'),'concurrent');assert.deepEqual(g.logs,[]);
});
test('application initialization uses CODEX_HOME before child environment is isolated',t=>{
 const f=fixture(t),previous=process.env.CODEX_HOME;process.env.CODEX_HOME=f.source;t.after(()=>{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;});fs.writeFileSync(path.join(f.source,'.env'),'from-selected-home');
 createCodexSubscriptionRuntime({root:path.dirname(f.home),runtime:{}});assert.equal(fs.readFileSync(path.join(f.home,'.env'),'utf8'),'from-selected-home');
});

test('unset CODEX_HOME falls back to the user .codex directory',t=>{
 const f=fixture(t),user=path.join(f.root,'user');fs.mkdirSync(path.join(user,'.codex'),{recursive:true});fs.writeFileSync(path.join(user,'.codex/.env'),'fallback');
 const env={...process.env,HOME:user,USERPROFILE:user};delete env.CODEX_HOME;
 const moduleUrl=new URL('../../desktop/platform/codex-subscription-runtime.mjs',import.meta.url).href;
 execFileSync(process.execPath,['--input-type=module','-e',`import {createCodexSubscriptionRuntime} from ${JSON.stringify(moduleUrl)};createCodexSubscriptionRuntime({root:${JSON.stringify(path.dirname(f.home))},runtime:{}});`],{env,stdio:'pipe',timeout:10000});
 assert.equal(fs.readFileSync(path.join(f.home,'.env'),'utf8'),'fallback');
});
