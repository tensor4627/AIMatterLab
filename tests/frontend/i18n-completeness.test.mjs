import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Ratchet: translations may only increase. Lower this baseline when adding entries;
// never raise it to accept new untranslated UI text. The dictionary mixes single and
// double quoted keys, so both styles are parsed. The baseline is 0: every Chinese
// t()/tr() literal in the renderer must have an English entry.
const MAX_MISSING = 0;

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const i18n=fs.readFileSync(path.join(root,'frontend','ui','i18n.ts'),'utf8');
const dictStart=i18n.indexOf('const english');
const dictEnd=i18n.indexOf('\n};',dictStart);
assert.ok(dictStart>=0&&dictEnd>dictStart,'i18n english dictionary not found');
const dictBody=i18n.slice(dictStart,dictEnd);

const unescape=value=>value.replace(/\\(.)/g,'$1');
const workflow=fs.readFileSync(path.join(root,'frontend','ui','workflow-i18n.ts'),'utf8');
const entries=[...(dictBody+'\n'+workflow).matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1\s*:\s*(["'])((?:\\.|(?!\3)[^\\])*)\3/g)]
 .map(match=>({key:unescape(match[2]),value:unescape(match[4])}));

function literals(){
 const files=[];
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.(tsx|ts)$/.test(entry.name))files.push(full);}};
 walk(path.join(root,'frontend'));
 const seen=new Set();
 for(const file of files){const source=fs.readFileSync(file,'utf8');for(const match of source.matchAll(/\b(?:t|tr)\(\s*(['"])([\u4e00-\u9fff][^'"]*?)\1/g))seen.add(match[2]);}
 return seen;
}

test('english dictionary has no duplicate keys and no empty translations',()=>{
 const keys=entries.map(entry=>entry.key);
 assert.equal(new Set(keys).size,keys.length,'duplicate dictionary keys');
 for(const entry of entries)assert.ok(entry.value.trim().length>0,'empty translation for '+entry.key);
});

test('untranslated renderer text does not grow beyond the recorded baseline',()=>{
 const known=new Set(entries.map(entry=>entry.key.trim()));
 const missing=[...literals()].filter(value=>!known.has(value.trim()));
 assert.ok(missing.length<=MAX_MISSING,`Untranslated UI text grew to ${missing.length} (baseline ${MAX_MISSING}): ${missing.slice(0,8).join(' | ')}`);
});
