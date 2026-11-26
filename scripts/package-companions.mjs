import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appPayloadName,appPayloadSigningPayload,fileDigest,readSignedRelease,setupName,signingPayload} from '../desktop/platform/update-release.mjs';
import {appOwnershipPath,createAppPayload,parseAppInventory,readAppPayload,runtimeMarkerPath} from '../desktop/platform/app-payload.mjs';
import {releaseSignature} from './sign-windows-setup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const prefix=metadata.productName+'-'+metadata.version;
const release=path.resolve(root,metadata.build.directories.output);
const kit=prefix+'-developer-kit.zip';
const unpacked='win-unpacked';
const installer=setupName(metadata.version);
const blockMap=installer+'.blockmap';
const artifacts=[
  prefix+'-win-x64.zip',
  installer,blockMap,'latest.yml',
  kit,
  unpacked+'/'+metadata.productName+'.exe',
  unpacked+'/resources/app.asar'
];

const setup=path.join(release,installer), mapFile=path.join(release,blockMap);
releaseSignature('Verify',setup);
const file={url:installer,size:fs.statSync(setup).size,sha512:await fileDigest(setup)};
const info={version:metadata.version,files:[file],path:installer,sha512:file.sha512,
  blockMap:{size:fs.statSync(mapFile).size,sha512:await fileDigest(mapFile)},releaseDate:new Date().toISOString()};
const payload=path.join(root,'.studio','installer',metadata.version+'-release.payload');
fs.writeFileSync(payload,signingPayload(info));
info.signature=releaseSignature('Manifest',payload);
const appDir=path.join(release,unpacked), abiMarker=path.join(appDir,runtimeMarkerPath);
if (fs.existsSync(abiMarker)) {
  const runtime=JSON.parse(fs.readFileSync(abiMarker,'utf8'));
  if (runtime.schemaVersion!==1 || runtime.installerVersion!==info.version) throw Error('Mismatched packaged application runtime ABI');
  const inventory=parseAppInventory(fs.readFileSync(path.join(appDir,appOwnershipPath),'utf8'));
  const url=appPayloadName(info.version), bytes=createAppPayload({version:info.version,runtimeAbiVersion:runtime.runtimeAbiVersion,inventory,
    readFile:name=>fs.readFileSync(path.join(appDir,name))});
  info.runtimeAbiVersion=runtime.runtimeAbiVersion;
  info.appPayload={url,size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')};
  readAppPayload(bytes,info);
  const extension=path.join(root,'.studio','installer',metadata.version+'-app-payload.payload');
  fs.writeFileSync(extension,appPayloadSigningPayload(info));
  info.appPayloadSignature=releaseSignature('Manifest',extension);
  fs.writeFileSync(path.join(release,url),bytes);
  artifacts.push(url);
}
const signed=Buffer.from(JSON.stringify(info,null,2)+'\n');
const verified=readSignedRelease(signed);
if (info.appPayload && !verified.appPayload) throw Error('Application payload signature verification failed');
// JSON is a YAML subset, so this manifest also retains the standard NSIS latest.yml fields.
fs.writeFileSync(path.join(release,'latest.yml'),signed);
fs.copyFileSync(path.join(root,'developer/skills/studio-tool-integration.zip'),path.join(release,kit));
const sums=[];
for(const name of artifacts){
  const hash=createHash('sha256');
  for await(const bytes of fs.createReadStream(path.join(release,name)))hash.update(bytes);
  sums.push(hash.digest('hex')+'  '+name);
}
fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),sums.join('\n')+'\n');
