import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign,verify} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {gzipSync,gunzipSync} from 'node:zlib';
import {appHelperPath,appOwnershipPath,createAppPayload,formatAppInventory,parseAppInventory,readAppPayload,runtimeMarkerPath} from '../../desktop/platform/app-payload.mjs';
import {beginApplicationUpdate,finishApplicationUpdate,readJournal,stagedPayload,transactionPaths,updatePaths} from '../../desktop/platform/app-update-transaction.mjs';
import {createLayeredWorkspaceUpdate,prepareLayeredStartup} from '../../desktop/platform/layered-update.mjs';
import {appPayloadName,appPayloadSigningPayload,readSignedRelease,setupName,signingPayload} from '../../desktop/platform/update-release.mjs';
import {runtimeAbiVersion} from '../../scripts/workspace-installer-files.mjs';

const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const hash = bytes => createHash('sha512').update(bytes).digest('base64');
const fingerprint = 'a'.repeat(64);
const currentVersion = '0.2.10', version = '0.2.11';
const decodeManifest = data => readSignedRelease(data,publicKey);
const compiled = value => Buffer.from(JSON.stringify(value));
const signature = value => sign('sha256',value,privateKey).toString('base64');

function release(bytes,runtimeAbiVersion=fingerprint) {
  const url = setupName(version), sha512 = hash(Buffer.from('fixture signed NSIS bytes'));
  const info = {version,files:[{url,size:25,sha512}],path:url,sha512,
    blockMap:{size:8,sha512:hash(Buffer.from('blockmap'))},runtimeAbiVersion,
    appPayload:{url:appPayloadName(version),size:bytes.length,sha512:hash(bytes)}};
  info.signature=signature(signingPayload(info));
  info.appPayloadSignature=signature(appPayloadSigningPayload(info));
  return info;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'aimatterlab-app-update-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const write = async (name,bytes) => {
    const file = path.join(root,name);
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,bytes);
    return file;
  };
  const read = name => fs.readFile(path.join(root,name),'utf8');
  const newFiles = new Map([['resources/app.asar','new app'],['resources/studio-skills/current.md','new skill'],
    ['resources/app.asar.unpacked/worker/runtime.py','new worker'],
    ['resources/agent-runtimes/dsh/runtime.json','new runtime'],
    ['resources/agent-runtimes/dsh/bundles/core.mjs','new DSH']]);
  const oldFiles = new Map(newFiles);
  oldFiles.delete('resources/studio-skills/current.md');
  oldFiles.set('resources/studio-skills/obsolete.md','old skill');
  const directories = ['resources/studio-skills','resources/app.asar.unpacked/worker','resources/agent-runtimes/dsh/bundles'];
  const activeOld = formatAppInventory({directories,files:[...oldFiles.keys()]});
  for (const [name,value] of oldFiles) await write(name,value.replace('new','old'));
  await write(appOwnershipPath,activeOld);
  await write(runtimeMarkerPath,compiled({schemaVersion:1,runtimeAbiVersion:fingerprint,installerVersion:'0.2.9'}));
  await write(appHelperPath,'fixture helper');
  await write('AIMatterLab.exe','fixture executable');
  await write('.aimatterlab-workspace','AIMatterLab workspace v1');
  const personal = ['sources/engine/README','user-cache/skills/personal','AGENTS.md','.config/connections',
    'resources/studio-skills/user-placed.md'];
  for (const name of personal) await write(name,'personal');
  const archive = createAppPayload({version,runtimeAbiVersion:fingerprint,inventory:{directories,files:[...newFiles.keys()]},
    readFile:name=>Buffer.from(newFiles.get(name))});
  const info = decodeManifest(compiled(release(archive)));
  const workspace = {directory:root}, paths = updatePaths(root);
  const updater = createLayeredWorkspaceUpdate({workspace,currentVersion,decodeManifest});
  return {root,write,read,activeOld,newFiles,personal,archive,info,workspace,paths,updater};
}

test('old clients verify the same NSIS signature and an invalid optional extension is stripped',async t=>{
  const {info,archive} = await fixture(t);
  assert.equal(verify('sha256',signingPayload(info),publicKey,Buffer.from(info.signature,'base64')),true);
  assert.deepEqual(decodeManifest(compiled(info)),info);
  for (const modified of [{...info,runtimeAbiVersion:'b'.repeat(64)},
    {...info,appPayload:{...info.appPayload,size:archive.length+1}},
    {...info,appPayload:{...info.appPayload,url:'../setup.exe'}},
    {...info,appPayloadSignature:undefined}]) {
    const retained = decodeManifest(compiled(modified));
    assert.equal(retained.appPayload,undefined);
    assert.equal(retained.runtimeAbiVersion,undefined);
    assert.equal(retained.files[0].url,info.files[0].url);
  }
  assert.throws(()=>decodeManifest(compiled({...info,blockMap:{...info.blockMap,size:10}})),/signature/);
});

test('the runtime identity ignores app changes but covers the Electron shell, native bytes and installer structure',async t=>{
  const {root,write} = await fixture(t);
  const electronExe = await write('shell/electron.exe','shell bytes');
  const installerFile = await write('shell/installer.nsh','installer structure');
  const native = 'resources/agent-runtimes/node_modules/node-pty/prebuilds/win32-x64/pty.node';
  await write(native,'native a');
  const compute = () => runtimeAbiVersion({appDir:root,electronExe,profile:{arch:'x64',electron:'44.5.1'},
    configurationFiles:[['installer',installerFile]]});
  // Installation data belongs to a different directory from the packaging input.
  const packageDir = await fs.mkdtemp(path.join(os.tmpdir(),'aimatterlab-abi-'));
  t.after(()=>fs.rm(packageDir,{recursive:true,force:true}));
  await fs.cp(path.join(root,'resources'),path.join(packageDir,'resources'),{recursive:true});
  await fs.copyFile(path.join(root,'AIMatterLab.exe'),path.join(packageDir,'AIMatterLab.exe'));
  const inputs = {appDir:packageDir,electronExe,profile:{arch:'x64',electron:'44.5.1'},configurationFiles:[['installer',installerFile]]};
  const before = await runtimeAbiVersion(inputs);
  await fs.writeFile(path.join(packageDir,'resources/app.asar'),'different app');
  await fs.writeFile(path.join(packageDir,'AIMatterLab.exe'),'version-bearing executable changes');
  await fs.writeFile(path.join(packageDir,'resources/agent-runtimes/dsh/bundles/core.mjs'),'new portable DSH');
  assert.equal(await runtimeAbiVersion({...inputs,profile:{electron:'44.5.1',arch:'x64'}}),before);
  await fs.writeFile(path.join(packageDir,native),'native b');
  assert.notEqual(await runtimeAbiVersion(inputs),before);
  await fs.writeFile(path.join(packageDir,native),'native a');
  await fs.writeFile(installerFile,'different installer structure');
  assert.notEqual(await runtimeAbiVersion(inputs),before);
  await fs.writeFile(installerFile,'installer structure');
  await fs.writeFile(electronExe,'different shell');
  assert.notEqual(await runtimeAbiVersion(inputs),before);
  await assert.rejects(compute(),/Unexpected installer payload/);
});

test('stage chooses signed compatible payloads and verifies every byte before making it restorable',async t=>{
  const {info,archive,updater,root,write,workspace} = await fixture(t);
  assert.deepEqual(await updater.candidate(info),info.appPayload);
  assert.equal(await updater.candidate(release(archive,'b'.repeat(64))),null);
  assert.equal(await updater.candidate({...info,signature:'unsigned'}),null);
  assert.equal(await updater.installerVersion(),'0.2.9');
  assert.equal(await updater.restore(),null);
  const tampered = Buffer.from(archive);
  tampered[12] ^= 1;
  await assert.rejects(updater.stage(info,new Response(tampered)),/SHA-512/);
  assert.equal(await updater.restore(),null);
  const progress = [];
  await updater.stage(info,new Response(archive),bytes=>progress.push(bytes));
  assert.deepEqual(progress,[archive.length]);
  assert.deepEqual(await updater.restore(),info);
  assert.equal(await fs.readFile(path.join(root,'resources/app.asar'),'utf8'),'old app');
  assert.equal(await prepareLayeredStartup({workspace,currentVersion}), 'normal');
  await write('resources/studio-skills/current.md','personal conflict');
  assert.equal(await updater.restore(),null);
  await assert.rejects(updater.launch(info),/unavailable/);
  assert.equal(await updater.candidate(info),null);
});

test('a correctly signed archive still rejects paths outside the exact application inventory',async t=>{
  const {archive} = await fixture(t);
  const content = gunzipSync(archive);
  const labelEnd = content.indexOf(10)+1;
  const headerEnd = labelEnd+4+content.readUInt32LE(labelEnd);
  const headerBytes = content.subarray(labelEnd+4,headerEnd);
  for (const filename of ['../AGENTS.md','resources/studio-skills/../outside','sources/engine','resources/studio-tools/file.node',
    'resources/studio-skills/con.json','resources/studio-skills/alias.txt:stream','resources/studio-skills/UPPER.md ']) {
    const header = JSON.parse(headerBytes);
    header.files.at(-1).path=filename;
    const text = compiled(header);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(text.length);
    const bad = gzipSync(Buffer.concat([content.subarray(0,labelEnd),length,text,content.subarray(headerEnd)]));
    assert.throws(()=>readAppPayload(bad,decodeManifest(compiled(release(bad)))),/Invalid or duplicate application file path/);
  }
});

test('compatible application replacement preserves exact ownership and keeps the installed NSIS base',async t=>{
  const {info,archive,paths,updater,read,newFiles,personal} = await fixture(t);
  await updater.stage(info,new Response(archive));
  const staged = await stagedPayload(paths,currentVersion,decodeManifest);
  const journal = await beginApplicationUpdate(paths,randomUUID(),currentVersion,staged);
  assert.equal((await readJournal(paths)).phase,'trial');
  const transaction = transactionPaths(paths,journal.token);
  assert.equal(await fs.readFile(path.join(transaction.backup,'resources/app.asar'),'utf8'),'old app');
  await finishApplicationUpdate(paths,journal,true);
  assert.equal(await readJournal(paths),null);
  assert.equal(await updater.installerVersion(),'0.2.9');
  for (const [name,value] of newFiles) assert.equal(await read(name),value);
  for (const name of personal) assert.equal(await read(name),'personal');
  await assert.rejects(read('resources/studio-skills/obsolete.md'),{code:'ENOENT'});
  assert.deepEqual(parseAppInventory(await read(appOwnershipPath)).files,[...newFiles.keys()].sort());
});

test('an interrupted or failed startup restores all owned program bytes and rejects the failed payload on retry',async t=>{
  const {archive,info,paths,updater,write,read,activeOld,personal} = await fixture(t);
  await updater.stage(info,new Response(archive));
  const staged = await stagedPayload(paths,currentVersion,decodeManifest);
  await beginApplicationUpdate(paths,randomUUID(),currentVersion,staged);
  // Simulate losing the helper after a replacement but before an executable
  // accepted the transaction. The durable journal and backup suffice.
  const recovery = await readJournal(paths);
  await write('resources/studio-skills/another-user-file.md','personal');
  await finishApplicationUpdate(paths,recovery,false);
  assert.equal(await read('resources/app.asar'),'old app');
  assert.equal(await read('resources/studio-skills/obsolete.md'),'old skill');
  assert.equal(await read('resources/app.asar.unpacked/worker/runtime.py'),'old worker');
  assert.equal(await read(appOwnershipPath),activeOld);
  for (const name of [...personal,'resources/studio-skills/another-user-file.md']) assert.equal(await read(name),'personal');
  await assert.rejects(read('resources/studio-skills/current.md'),{code:'ENOENT'});
  assert.equal(await updater.candidate(info),null);
});

test('staging refuses linked program descendants without touching their targets',async t=>{
  const {archive,info,paths,updater,read,root} = await fixture(t);
  const existing = path.join(root,'resources','studio-skills'), unrelated = path.join(root,'sources');
  await fs.rename(existing,path.join(root,'resources','old-skills'));
  await fs.symlink(unrelated,existing,process.platform==='win32'?'junction':'dir');
  await assert.rejects(updater.stage(info,new Response(archive)),/Linked/);
  assert.equal(await read('sources/engine/README'),'personal');
  await assert.rejects(fs.stat(paths.archive),{code:'ENOENT'});
});
