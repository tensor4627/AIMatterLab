import {createHash} from 'node:crypto';
import {gunzipSync, gzipSync} from 'node:zlib';
import {maxAppPayload, validReleaseVersion, validRuntimeAbi, validSha512} from './update-release.mjs';

export const runtimeMarkerPath = 'resources/studio-updater/runtime-abi.json';
export const appOwnershipPath = 'resources/studio-updater/app-files.txt';
export const appHelperPath = 'resources/studio-updater/desktop/platform/app-update-helper.mjs';

const appFiles = new Set(['resources/app.asar', 'resources/tool-sources.json', 'resources/agent-runtimes/dsh/runtime.json']);
const appTrees = [
  'resources/app.asar.unpacked/worker',
  'resources/agent-runtimes/dsh/bundles',
  'resources/studio-dsh',
  'resources/studio-skills',
  'resources/studio-tools',
  'resources/terminal-service'
];
const maxExpanded = 128 * 1024 * 1024;
export const maxAppInventory = 4 * 1024 * 1024;
const label = Buffer.from('AIMatterLab application archive v1\n');
const unsafePart = /[<>:"/\\|?*\u0000-\u001f]|[ .]$|^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const nativeAsset = /\.(?:dll|exe|node|pyd|dylib|so(?:\.\d+)*)$/i;
const ascending = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const sha512 = bytes => createHash('sha512').update(bytes).digest('base64');

export function appPathKind(name) {
  if (typeof name !== 'string' || name.length > 1024 ||
      nativeAsset.test(name) || name.split('/').some(part => !part || part.length > 255 || unsafePart.test(part))) return null;
  if (appFiles.has(name)) return 'file';
  if (appTrees.includes(name)) return 'directory';
  if (appTrees.some(root => name.startsWith(root+'/'))) return 'asset';
  return null;
}

function validateInventory(directories, files) {
  if (!Array.isArray(directories) || !Array.isArray(files) || directories.length + files.length > 30000) {
    throw Error('Invalid application file inventory');
  }
  const dirs = new Set(directories), names = new Set();
  function validate(name, allowed) {
    if (!allowed.includes(appPathKind(name)) || names.has(name.toLowerCase())) throw Error('Invalid or duplicate application file path');
    names.add(name.toLowerCase());
    const parent = name.slice(0,name.lastIndexOf('/'));
    if (appPathKind(parent) && !dirs.has(parent)) throw Error('Missing application directory in inventory');
  }
  for (const name of directories) validate(name,['directory','asset']);
  for (const name of files) validate(name,['file','asset']);
  if (!files.includes('resources/app.asar')) throw Error('Missing application archive');
  return {directories:[...directories].sort(ascending),files:[...files].sort(ascending)};
}

export function parseAppInventory(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxAppInventory) throw Error('Invalid application file inventory size');
  const directories = [], files = [];
  for (const line of text.replace(/\r?\n$/,'').split(/\r?\n/)) {
    if (line.startsWith('D|')) directories.push(line.slice(2).replaceAll('\\','/'));
    else if (line.startsWith('F|')) files.push(line.slice(2).replaceAll('\\','/'));
    else throw Error('Invalid application file inventory');
  }
  return validateInventory(directories,files);
}

export function formatAppInventory({directories,files}) {
  return [...directories.map(name=>'D|'+name),...files.map(name=>'F|'+name)]
    .map(line=>line.replaceAll('/','\\')).join('\n')+'\n';
}

export function createAppPayload({version,runtimeAbiVersion,inventory,readFile}) {
  const {directories,files} = validateInventory(inventory.directories,inventory.files);
  const contents = files.map(readFile);
  const metadata = {schemaVersion:1,version,runtimeAbiVersion,directories,
    files:files.map((path,index)=>({path,size:contents[index].length,sha512:sha512(contents[index])}))};
  const header = Buffer.from(JSON.stringify(metadata));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  const size = contents.reduce((sum,bytes)=>sum+bytes.length,label.length+length.length+header.length);
  if (header.length > maxAppInventory || size > maxExpanded ||
      !validReleaseVersion(version) || !validRuntimeAbi(runtimeAbiVersion)) throw Error('Invalid or oversized application payload');
  const bytes = gzipSync(Buffer.concat([label,length,header,...contents],size));
  if (bytes.length > maxAppPayload) throw Error('Compressed application payload is too large');
  return bytes;
}

export function readAppPayload(bytes, info) {
  if (!info.appPayload || bytes.length !== info.appPayload.size || sha512(bytes) !== info.appPayload.sha512) {
    throw Error('Application payload SHA-512 verification failed');
  }
  const content = gunzipSync(bytes,{maxOutputLength:maxExpanded});
  if (content.length < label.length+4 || !content.subarray(0,label.length).equals(label)) throw Error('Invalid application archive');
  const headerLength = content.readUInt32LE(label.length);
  const start = label.length+4;
  let offset = start+headerLength;
  if (!headerLength || headerLength > maxAppInventory || offset > content.length) throw Error('Invalid application archive header');
  const header = JSON.parse(content.toString('utf8',start,offset));
  if (header?.schemaVersion !== 1 || header.version !== info.version || header.runtimeAbiVersion !== info.runtimeAbiVersion ||
      !Array.isArray(header.files)) throw Error('Application payload version or runtime does not match release');
  const inventory = validateInventory(header.directories,header.files.map(file=>file?.path));
  const files = new Map();
  for (const file of header.files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > content.length-offset ||
        !validSha512(file.sha512)) throw Error('Invalid application archive file metadata');
    const data = content.subarray(offset,offset+file.size);
    if (sha512(data) !== file.sha512) throw Error('Application archive file hash mismatch');
    files.set(file.path,data);
    offset += file.size;
  }
  if (offset !== content.length) throw Error('Unexpected bytes in application archive');
  return {inventory, files};
}
