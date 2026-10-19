import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {discoverSources,sourceContext} from '../desktop/source-projects.mjs';
test('source discovery checks real entry points, de-duplicates, records hashes without imports',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-source-'));
 try{const root=path.join(tmp,'pygas');fs.mkdirSync(path.join(root,'base'),{recursive:true});fs.mkdirSync(path.join(root,'tools'));fs.writeFileSync(path.join(root,'pyproject.toml'),'name="pygas"');fs.writeFileSync(path.join(root,'base/colvar.py'),'# real source');fs.writeFileSync(path.join(root,'tools/graph_workflow.py'),'# renderer');
 const list=discoverSources({cwd:path.join(tmp,'studio'),roots:[root,root]});assert.equal(list.length,1);assert.deepEqual(discoverSources({cwd:path.join(tmp,'studio'),roots:[root],ids:[]}),[]);assert.equal(discoverSources({roots:[root],ids:['pygas']}).length,1);assert.equal(list[0].files.length,3);assert.equal(list[0].files[0].sha256.length,64);assert.match(sourceContext(list),/inspect_source_project/);assert.match(sourceContext(list),/render_pygas_workflow/);fs.unlinkSync(path.join(root,'base/colvar.py'));assert.equal(discoverSources({roots:[root]}).length,0);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
