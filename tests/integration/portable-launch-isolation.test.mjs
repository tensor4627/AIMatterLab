import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {studioProfileRoot} from '../../desktop/platform/studio-profile.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const packageManifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const builderRequire=createRequire(import.meta.resolve('electron-builder'));
// Initialize the supported public entry before its internal target class; the
// builder's cross-platform packager modules otherwise have a circular load.
builderRequire('app-builder-lib');
const builderRoot=path.resolve(path.dirname(builderRequire.resolve('app-builder-lib')),'..');
const {NsisTarget}=builderRequire(path.join(builderRoot,'out','targets','nsis','NsisTarget.js'));
const portableTemplate=fs.readFileSync(path.join(builderRoot,'templates','nsis','portable.nsi'),'utf8');

// Execute the installed builder's real option -> NSIS define conversion. An
// empty architecture map and its public effectiveOptionComputed stop hook keep
// this strictly read-only: no archive, compiler, extraction or application runs.
async function portableDefines(options){
 let captured;
 const target={
  name:'portable',isPortable:true,isWebInstaller:false,isUnicodeEnabled:true,
  outDir:root,options,
  installerFilenamePattern:()=> 'never-built-fixture.exe',
  computeVersionKey:()=>[],
  configureDefinesForAllTypeOfInstaller:()=>{},
  packager:{
   projectDir:root,platformSpecificBuildOptions:{},config:{},compression:'store',
   appInfo:{id:'science.gpusampling.portable-fixture',name:'studio-portable-fixture',
    productName:'AIMatterLab portable fixture',productFilename:'AIMatterLab portable fixture',
    sanitizedName:'studio-portable-fixture',description:'Read-only define fixture',
    version:'1.0.0',getVersionInWeirdWindowsForm:()=> '1.0.0.0'},
   info:{metadata:{},buildResourcesDir:root,emitArtifactBuildStarted:async()=>{}},
   expandArtifactNamePattern:()=> 'never-built-fixture.exe',
   getIconPath:async()=>null,
   packagerOptions:{effectiveOptionComputed:async([defines])=>{captured=structuredClone(defines);return true;}},
  },
 };
 await NsisTarget.prototype.buildInstaller.call(target,new Map());
 assert(captured,'The actual builder must reach its pre-compilation option hook');
 return captured;
}

// In pinned 26.15.3, nsisOptions.d.ts describes false as per-launch, but the
// installed generator emits UNPACK_DIR_NAME for false. Exercise the real code.
test('installed builder default and false generate a fixed per-build portable temp directory',async()=>{
 for(const options of [{},{unpackDirName:false}]){
  const defines=await portableDefines(options);
  assert.equal(typeof defines.UNPACK_DIR_NAME,'string');
  assert(defines.UNPACK_DIR_NAME.length>0);
 }
});

test('installed builder true selects the real NSIS per-launch plugin directory branch',async()=>{
 const defines=await portableDefines({unpackDirName:true});
 assert.equal(Object.hasOwn(defines,'UNPACK_DIR_NAME'),false);
 assert.match(portableTemplate,/StrCpy\s+\$INSTDIR\s+"\$PLUGINSDIR\\app"\s+!ifdef UNPACK_DIR_NAME\s+StrCpy\s+\$INSTDIR\s+"\$TEMP\\\$\{UNPACK_DIR_NAME\}"\s+!endif/);
 assert.match(portableTemplate,/RMDir \/r \$INSTDIR/);
 assert.match(portableTemplate,/ExecWait "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}/);
});

test('repository portable build cannot enable shared extraction and cleanup across launches',async()=>{
 assert.equal(packageManifest.build?.portable?.unpackDirName,true,
  'Pinned electron-builder needs true to omit its fixed per-build UNPACK_DIR_NAME');
 const defines=await portableDefines(packageManifest.build.portable);
 assert.equal(Object.hasOwn(defines,'UNPACK_DIR_NAME'),false);
 const bitmap=fs.readFileSync(defines.SPLASH_IMAGE);
 assert.equal(bitmap.toString('ascii',0,2),'BM');assert.equal(bitmap.readUInt16LE(28),24);
 assert(portableTemplate.indexOf('BgImage::Redraw')<portableTemplate.indexOf('!insertmacro extractEmbeddedAppPackage'));
 assert.match(portableTemplate,/SetEnvironmentVariable\(t, t\)i \("PORTABLE_EXECUTABLE_DIR", "\$EXEDIR"\)/);
});

test('per-launch extraction paths keep the existing checkout profile route unchanged',()=>{
 const portableDir=path.join(root,'release','portable-profile-fixture');
 const profiles=['launch-one','launch-two'].map(name=>studioProfileRoot({
  isPackaged:true,portableDir,
  execPath:path.join(os.tmpdir(),'read-only-nsis-fixture',name,'app','AIMatterLab.exe'),
 }));
 assert.deepEqual(profiles,[path.join(root,'.config'),path.join(root,'.config')]);
});
