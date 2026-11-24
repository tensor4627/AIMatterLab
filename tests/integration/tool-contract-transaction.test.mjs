import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncToolContracts} from "../../scripts/sync-tool-contracts.mjs";

const canonical=fs.readFileSync(new URL("../../contracts/tools/engine-contracts.json",import.meta.url));
const packageSchema=fs.readFileSync(new URL("../../contracts/tools/tool-package.schema.json",import.meta.url));
const packageValidator=fs.readFileSync(new URL("../../contracts/tools/tool-package.mjs",import.meta.url));
const aimlabToolsContract=fs.readFileSync(new URL("../../contracts/tools/aimlab-tools.mjs",import.meta.url));
const workerReference=fs.readFileSync(new URL("../../installation/examples/worker-smoke.py",import.meta.url));

function temporary(t){
 const base=path.resolve(process.env.STUDIO_RESOURCE_TEST_ROOT||os.tmpdir());fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'studio-tool-transaction-'));
 t.after(()=>{assert(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
function put(root,name,bytes){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return target;}

test('multi-resource synchronization stages files and rolls a failed update back',t=>{
 const root=temporary(t);
 put(root,'contracts/tools/engine-contracts.json',canonical);
 put(root,'contracts/tools/tool-package.schema.json',packageSchema);
 put(root,'contracts/workflows/roadmap.schema.json',fs.readFileSync(new URL('../../contracts/workflows/roadmap.schema.json',import.meta.url)));
 put(root,'contracts/workflows/task-draft.schema.json',fs.readFileSync(new URL('../../contracts/workflows/task-draft.schema.json',import.meta.url)));
 put(root,'contracts/tools/tool-package.mjs',packageValidator);
 put(root,'contracts/tools/aimlab-tools.mjs',aimlabToolsContract);
 put(root,'installation/examples/worker-smoke.py',workerReference);
 const target=put(root,'backend/worker/studio_worker/engine_contracts.json','{"old":true}');
 let renames=0;
 assert.throws(()=>syncToolContracts({root},{rename:(from,to)=>{renames++;if(renames===2)throw Error('injected rename failure');return fs.renameSync(from,to);}}),/injected rename failure/);
 assert.equal(fs.readFileSync(target,'utf8'),'{"old":true}','the already replaced target must be restored');
 assert.equal(renames,2);
 const residual=[];
 const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.(?:tmp|restore)$/.test(item.name))residual.push(path.relative(root,file));}};
 walk(root);
 assert.deepEqual(residual,[],'temporary and restore files must be cleaned up');
 assert.equal(syncToolContracts({root}).status,'updated');
 assert.equal(syncToolContracts({root,check:true}).status,'current');
 assert.equal(fs.readFileSync(target).equals(canonical),true);
});
