import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {CodexBridge,PROTOCOL_VERSION} from "../../agent/providers/codex.mjs";
const schema=JSON.parse(fs.readFileSync(new URL("../../agent/tools/custom-cv-tool-schema.json",import.meta.url),'utf8'));
test('proposal schema exposes only formula data and exact worker parameter vocabulary',()=>{
 assert.deepEqual(Object.keys(schema.properties).sort(),['library_review','spec','values']);assert.equal(schema.additionalProperties,false);const spec=schema.properties.spec;assert.equal(spec.additionalProperties,false);assert.equal(spec.properties.symbols.type,'array');assert.equal(spec.properties.symbols.items.additionalProperties,false);assert.deepEqual(spec.properties.pbc.enum,['none','row_mic']);assert.deepEqual(spec.properties.parameters.items.properties.type.enum,['number','integer','number_vector','integer_vector','number_matrix']);assert.equal(spec.properties.parameters.items.additionalProperties,false);assert.equal(spec.properties.parameters.items.properties.exclusive_minimum,undefined);assert.equal(spec.properties.parameters.items.properties.min.type,'number');
 for(const forbidden of ['id','expected','provider','approved','code','execute','share'])assert.equal(schema.properties[forbidden],undefined);
});
test('scoped execution tools use the same permission path, while custom approval and sharing remain human',async()=>{
 let argumentsSeen;
 const bridge=new CodexBridge({launchDependencies:{execute:async()=>({stdout:'codex-cli '+PROTOCOL_VERSION}),spawnProcess:(_executable,args)=>{
  argumentsSeen=args;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin={destroyed:false,write:raw=>{const message=JSON.parse(raw);if(message.id!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:message.id,result:{}})+'\n'));}};return child;
 }}});
 try{
  await bridge.start('synthetic-cli',{url:'http://127.0.0.1:1/providers/codex',tokens:{mcp:'synthetic-token'}});
  const approved=argumentsSeen.filter(value=>/^mcp_servers\.gpusampling\.tools\.[a-z_]+\.approval_mode="approve"$/.test(value)).map(value=>value.split('.')[3]);
  assert(approved.includes('propose_custom_cv'));for(const name of ['validate_run','submit_run','cancel_run','validate_cluster_run','submit_cluster_run','cancel_cluster_run'])assert(approved.includes(name));
  for(const forbidden of ['approve_formula','approve_code','customCv.validate','customCv.sharing'])assert(!approved.includes(forbidden));
 }finally{bridge.close();}
 const main=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8');assert(main.includes('custom-cv-tool-schema.json'));assert(main.includes('annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}'));
});
