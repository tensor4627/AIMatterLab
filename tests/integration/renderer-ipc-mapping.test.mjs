import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Static guard for the renderer IPC contract: every channel the preload bridge
// exposes must be registered by a main-process handler, and every statically
// registered privileged handler must be reachable from the preload allowlist.
// Dynamic prefix registrations (handle('prefix.'+name)) are matched by prefix
// and additionally require that the method suffix appears as a production
// string literal, so deleting a table entry fails this test. Electron is never
// started and no business handler is invoked.

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=execSync('git ls-files',{cwd:root,encoding:'utf8'}).split('\n')
 .filter(name=>/\.(?:mjs|cjs)$/.test(name)&&/^(?:desktop|backend\/main)\//.test(name));

function preloadMethods(){
 const text=fs.readFileSync(path.join(root,'desktop/preload.cjs'),'utf8');
 assert.match(text,/contextBridge\.exposeInMainWorld\('studio'/);
 const methods=[];
 const setStart=text.indexOf('methods=new Set(['),setEnd=text.indexOf('])',setStart);
 assert.ok(setStart>=0&&setEnd>setStart,'preload methods set not found');
 for(const match of text.slice(setStart,setEnd).matchAll(/'([A-Za-z][\w.:-]+)'/g))methods.push(match[1]);
 const loopStart=text.indexOf('for(const name of ['),loopEnd=text.indexOf('])methods.add',loopStart);
 assert.ok(loopStart>=0&&loopEnd>loopStart,'preload extension loop not found');
 for(const match of text.slice(loopStart,loopEnd).matchAll(/'([A-Za-z][\w.:-]+)'/g))methods.push(match[1]);
 return methods;
}

function productionChannels(){
 const exact=new Map(),prefixes=new Map(),literals=new Set();
 for(const file of files){
  const text=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of text.matchAll(/'([A-Za-z][A-Za-z0-9_.:-]{1,80})'/g))literals.add(match[1]);
  for(const match of text.matchAll(/\bhandle\('([^']+)'/g)){
   let name=match[1];
   if(name==='studio:')continue;
   if(name.startsWith('studio:'))name=name.slice(7);
   if(name.endsWith('.'))prefixes.set(name,file);else exact.set(name,file);
  }
  for(const match of text.matchAll(/ipcMain\.handle\('studio:([^']+)'/g))exact.set(match[1],file);
  if(text.includes('handle('))for(const match of text.matchAll(/\['([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)','([A-Za-z][A-Za-z0-9]*)'\]/g))exact.set(match[1],file);
 }
 return {exact,prefixes,literals};
}

test('every preload channel has a registered main-process handler',()=>{
 const methods=preloadMethods();
 assert.ok(methods.length>=100,'preload allowlist unexpectedly small');
 const {exact,prefixes,literals}=productionChannels();
 const missing=methods.filter(name=>!exact.has(name)&&![...prefixes.keys()].some(prefix=>name.startsWith(prefix)));
 assert.deepEqual(missing,[],'preload channels without a handler');
 const unlocked=methods.filter(name=>!exact.has(name)).filter(name=>!literals.has(name.split('.').pop()));
 assert.deepEqual(unlocked,[],'dynamic handler table members missing from production sources');
});

test('every statically registered privileged handler is reachable from preload',()=>{
 const methods=new Set(preloadMethods());
 const {exact}=productionChannels();
 const unreachable=[...exact.keys()].filter(name=>!methods.has(name));
 assert.deepEqual(unreachable,[],'main-process handlers unreachable from the renderer bridge');
});

test('preload exposes each channel once and rejects unknown channels at runtime',()=>{
 const methods=preloadMethods();
 assert.equal(new Set(methods).size,methods.length,'duplicate preload channel entries');
 const text=fs.readFileSync(path.join(root,'desktop/preload.cjs'),'utf8');
 assert.match(text,/if\(!methods\.has\(method\)\) return Promise\.reject\(new Error\('Unsupported method'\)\)/);
});
