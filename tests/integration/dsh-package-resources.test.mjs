import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const {FileMatcher,copyFiles}=builder('app-builder-lib/out/fileMatcher.js');
test('configured DSH extra resources survive actual builder copying with nested conflicting dependencies',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-package-copy-')),source=path.join(root,'source'),destination=path.join(root,'resources');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dsh='.studio/agent-runtimes/dsh',fixtures={
  'runtime.json':'{"schemaVersion":1,"fixture":"owned offline package copy"}\n',
  'node_modules/@deepseek-ai/dsh/package.json':'{"name":"@deepseek-ai/dsh","version":"0.2.2-rc.1"}',
  'node_modules/@deepseek-ai/dsh/lib/bin.js':'export const fixture=true;\n',
  'node_modules/@deepseek-ai/dsh/node_modules/shared/package.json':'{"name":"shared","version":"2.0.0"}',
  'node_modules/shared/package.json':'{"name":"shared","version":"1.0.0"}',
  'node_modules/shared/.metadata/private-entry':'packaged dependency asset\n',
  'node_modules/shared/assets/minimal.wasm':Buffer.from([0,97,115,109,1,0,0,0])
 };
 for(const [name,content]of Object.entries(fixtures)){const file=path.join(source,dsh,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
 const manifest=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')),resources=manifest.build.extraResources.filter(value=>value.to==='agent-runtimes/dsh'||value.to.startsWith('agent-runtimes/dsh/'));
 assert(resources.length>0);const matchers=resources.map(value=>new FileMatcher(path.join(source,value.from),path.join(destination,value.to),value=>value,value.filter));await copyFiles(matchers,null,false);
 for(const [name,content]of Object.entries(fixtures)){const actual=fs.readFileSync(path.join(destination,'agent-runtimes/dsh',name));assert.deepEqual(actual,Buffer.from(content),name);}
});
