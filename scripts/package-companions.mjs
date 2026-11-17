import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileDigest, readSignedRelease, setupName, signingPayload} from '../desktop/platform/update-release.mjs';
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
const signed=Buffer.from(JSON.stringify(info,null,2)+'\n');
readSignedRelease(signed);
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
