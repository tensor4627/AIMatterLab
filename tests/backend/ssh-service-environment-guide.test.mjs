import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createComputeProfiles} from '../../backend/main/compute/compute-profiles.mjs';
import {sshServiceEnvironmentGuide,writeSshServiceEnvironmentGuide} from '../../backend/main/compute/ssh-service-environment-guide.mjs';

const ssh={kind:'ssh',name:'Private fixture connection',host:'private-fixture.invalid',username:'private-fixture-user',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-service-env-guide-')),catalog=new Catalog(path.join(root,'catalog')),guideRoot=path.join(root,'guides');t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});return {root,catalog,guideRoot,profiles:createComputeProfiles({catalog,guideRoot})};}

test('human SSH profile save derives only connection-specific guidance and keeps activation out of skills',t=>{
 const f=fixture(t),serviceEnvironment={python:'/fixture/conda/envs/studio/bin/python',activation:'source /fixture/conda.sh\nexport API_TOKEN=NEVER_COPY_PRIVATE_VALUE\nconda activate studio'},saved=f.profiles.save({expectedVersion:0,...ssh,serviceEnvironment});
 const file=path.join(f.guideRoot,saved.id,'SKILL.md'),body=fs.readFileSync(file,'utf8');assert(body.includes(saved.id));assert(body.includes('Profile version: 1'));assert(body.includes(serviceEnvironment.python));assert(body.includes('existing Conda or virtual environment'));assert(!body.includes('NEVER_COPY_PRIVATE_VALUE'));assert(!body.includes(serviceEnvironment.activation));assert(!body.includes(ssh.host));assert(!body.includes(ssh.username));assert(!body.includes(ssh.name));assert.deepEqual(f.profiles.read({id:saved.id}).serviceEnvironment,serviceEnvironment);assert.deepEqual(fs.readdirSync(f.guideRoot),[saved.id]);
});

test('guide update follows optimistic profile version, cannot modify another connection and never changes legacy shape',t=>{
 const f=fixture(t),first=f.profiles.save({expectedVersion:0,...ssh}),second=f.profiles.save({expectedVersion:0,...ssh,name:'Second fixture'}),firstFile=path.join(f.guideRoot,first.id,'SKILL.md'),secondFile=path.join(f.guideRoot,second.id,'SKILL.md'),secondBefore=fs.readFileSync(secondFile,'utf8');assert(!Object.hasOwn(first,'serviceEnvironment'));assert(fs.readFileSync(firstFile,'utf8').includes('Python executable: `python3`'));
 const updated=f.profiles.save({id:first.id,expectedVersion:1,...ssh,serviceEnvironment:{python:'python3.12',activation:''}});assert.equal(updated.version,2);assert(fs.readFileSync(firstFile,'utf8').includes('Profile version: 2'));assert.equal(fs.readFileSync(secondFile,'utf8'),secondBefore);
 const firstBefore=fs.readFileSync(firstFile,'utf8');assert.throws(()=>f.profiles.save({id:first.id,expectedVersion:1,...ssh,serviceEnvironment:{python:'python',activation:''}}),/profile_changed/);assert.equal(fs.readFileSync(firstFile,'utf8'),firstBefore);assert.equal(f.profiles.save({id:second.id,expectedVersion:1,...ssh,name:'Second fixture'}).version,1);assert(!Object.hasOwn(f.profiles.read({id:second.id}),'serviceEnvironment'));
});

test('unsafe guide targets fail before profile persistence and do not replace unrelated local files',t=>{
 const f=fixture(t),blocked=path.join(f.root,'must-stay-file');fs.writeFileSync(blocked,'PRESERVE');const profiles=createComputeProfiles({catalog:f.catalog,guideRoot:blocked});assert.throws(()=>profiles.save({expectedVersion:0,...ssh}),/guide_unavailable/);assert.equal(f.catalog.list('compute-profile').length,0);assert.equal(fs.readFileSync(blocked,'utf8'),'PRESERVE');
 const profile={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',version:1,...ssh};assert.throws(()=>writeSshServiceEnvironmentGuide(f.guideRoot,{...profile,id:'../escape'}),/guide_unavailable/);assert.throws(()=>sshServiceEnvironmentGuide({...profile,serviceEnvironment:{python:'python\nPRIVATE',activation:''}}),/guide_unavailable/);assert(!fs.existsSync(f.guideRoot));
});

test('generated SKILL destination refuses hard links and preserves the existing profile on update failure',t=>{
 const f=fixture(t),saved=f.profiles.save({expectedVersion:0,...ssh}),file=path.join(f.guideRoot,saved.id,'SKILL.md'),other=path.join(f.root,'other-file.md');fs.linkSync(file,other);const before=fs.readFileSync(file,'utf8');assert.throws(()=>f.profiles.save({id:saved.id,expectedVersion:1,...ssh,serviceEnvironment:{python:'python3.12',activation:''}}),/guide_unavailable/);assert.equal(f.profiles.read({id:saved.id}).version,1);assert.equal(fs.readFileSync(other,'utf8'),before);
});
