import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));

test('renderer API clients depend on contracts, not on feature implementations',()=>{
 const directory=path.join(root,'frontend','api');
 for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.ts'))){
  const source=fs.readFileSync(path.join(directory,name),'utf8');
  assert.doesNotMatch(source,/from ['"](?:\.\.\/)+features\//,`${name} imports feature implementation types`);
 }
});

test('staged authoring DTOs live in contracts and the old feature copies are gone',()=>{
 const dto=fs.readFileSync(path.join(root,'contracts','dto','stage.ts'),'utf8');
 for(const name of ['StageInspection','TaskStageApi','ConsumerPrefill','ConsumerStageInspection','ConsumerStageProposal','ConsumerTargetScope','ConsumerTargetInspection','ConsumerArtifactOption','ConsumerArtifactList','ConsumerArtifactAdoption','ConsumerArtifactApi']){
  assert.match(dto,new RegExp('(?:interface|type) '+name+'\\b'),'missing contract type '+name);
 }
 for(const stale of ['task-stage-types.ts','consumer-stage-types.ts','consumer-artifact-types.ts']){
  assert.equal(fs.existsSync(path.join(root,'frontend','features','workflows',stale)),false,'stale feature DTO remains: '+stale);
 }
});

test('the moved DTOs import only pure contract modules',()=>{
 const dto=fs.readFileSync(path.join(root,'contracts','dto','stage.ts'),'utf8');
 for(const match of dto.matchAll(/from ['"]([^'"]+)['"]/g)){
  assert.ok(match[1].startsWith('../workflows/')||match[1].startsWith('./'),'DTO import escaped contracts: '+match[1]);
 }
});
