import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createSetupGuide} from '../../desktop/platform/setup-guide.mjs';

function profile(t,existingProfile=false){
  const directory=mkdtempSync(path.join(tmpdir(),'aimatterlab-setup-')),catalog=new Catalog(directory),opened=[];
  t.after(()=>{catalog.db.close();rmSync(directory,{recursive:true,force:true});});
  const open=existing=>createSetupGuide({catalog,directory,existingProfile:existing,directoryKind:'profile',openDirectory:target=>{opened.push(target);return '';}});
  return {guide:open(existingProfile),open,opened,directory,catalog};
}

test('fresh profiles resume the last setup page; completing or skipping survives relaunch and help replay',t=>{
  const {guide,open}=profile(t);
  assert.equal(guide.info().page,'welcome');
  assert.equal(guide.progress({page:'compute'}).page,'compute');
  const restored=open(true);
  assert.equal(restored.info().page,'compute');
  restored.progress({page:'complete'});
  assert.equal(open(true).progress({page:'agent'}).page,'complete');
});

test('an existing desktop opens its workspace and preserves its configuration',t=>{
  const {guide,catalog,open}=profile(t,true);
  catalog.put('settings','main',{language:'en',workerRoot:'existing-root'});
  assert.equal(guide.info().page,'complete');
  assert.equal(open(true).progress({page:'welcome'}).page,'complete');
  assert.deepEqual(catalog.get('settings','main'),{language:'en',workerRoot:'existing-root'});
});

test('only known pages are saved and only the main-process workspace directory can be opened',async t=>{
  const {guide,opened,directory}=profile(t);
  for(const request of [{page:'invalid'},{page:'agent',host:'other'},{}])assert.throws(()=>guide.progress(request));
  assert.equal(guide.info().page,'welcome');
  await assert.rejects(guide.open({path:'another-directory'}));
  await guide.open({});
  assert.deepEqual(opened,[directory]);
});
