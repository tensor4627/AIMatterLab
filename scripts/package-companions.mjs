import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const prefix=metadata.productName+'-'+metadata.version;
const release=path.resolve(root,metadata.build.directories.output);
const kit=prefix+'-developer-kit.zip';
const unpacked='win-unpacked';
const artifacts=[
  prefix+'-win-x64.zip',
  prefix+'-win-x64-portable.exe',
  kit,
  unpacked+'/'+metadata.productName+'.exe',
  unpacked+'/resources/app.asar'
];

fs.copyFileSync(path.join(root,'developer/skills/studio-tool-integration.zip'),path.join(release,kit));
const sums=[];
for(const name of artifacts){
  const hash=createHash('sha256');
  for await(const bytes of fs.createReadStream(path.join(release,name)))hash.update(bytes);
  sums.push(hash.digest('hex')+'  '+name);
}
fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),sums.join('\n')+'\n');
