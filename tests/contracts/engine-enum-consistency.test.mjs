import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {engineContracts} from "../../contracts/tools/engine-contracts.mjs";

const root=fileURLToPath(new URL('../..',import.meta.url));
const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');

function sorted(values){return [...new Set(values)].sort();}

test('execution engine identifiers are identical in the contract, adapter validation and renderer list',()=>{
 const contract=sorted(Object.keys(engineContracts.engines));
 const deployment=read('contracts/compute/deployment.mjs').match(/const engines=new Set\(\[([^\]]+)\]\)/);
 assert.ok(deployment,'deployment engine allowlist missing');
 const adapter=sorted([...deployment[1].matchAll(/'([^']+)'/g)].map(match=>match[1]));
 const rendererSource=read('frontend/ui/presentation/engines.ts').match(/export const engines=\[([\s\S]*?)\];/);
 assert.ok(rendererSource,'renderer engine list missing');
 const renderer=sorted([...rendererSource[1].matchAll(/\['([^']+)'/g)].map(match=>match[1]));
 assert.deepEqual(adapter,contract,'contract and adapter engine allowlists differ');
 assert.deepEqual(renderer,contract,'renderer and contract engine lists differ');
 assert.equal(contract.length,15);
});
