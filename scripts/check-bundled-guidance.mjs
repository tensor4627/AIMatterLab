import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ScientificSkills} from '../agent/skills/scientific-skills.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const prompt='agent/context/AGENTS.md';
const mapPath='agent/skills/scientific-skill-map.json';
const guidanceModules=[
 prompt,
 'agent/context/agent-settings.mjs',
 'agent/context/interaction-mode.mjs',
 'agent/context/task-turn-context.mjs',
 'agent/providers/dsh-policy.mjs',
 'agent/sessions/requests.mjs',
 'agent/sessions/resource-routing.mjs',
 'agent/sessions/terminal-turn.mjs',
 mapPath,
 'agent/skills/scientific-context.mjs',
 'agent/skills/scientific-skill-router.mjs',
 'agent/skills/scientific-skills.mjs',
 'backend/main/workspace/task-authoring.mjs',
];

function builderAsar(projectDir) {
 const localRequire=createRequire(path.join(projectDir,'package.json'));
 const builderRequire=createRequire(localRequire.resolve('electron-builder/package.json'));
 const appBuilderRequire=createRequire(builderRequire.resolve('app-builder-lib/package.json'));
 return appBuilderRequire('@electron/asar');
}

function fileNames(directory) {
 const result=[];
 function walk(parts) {
  for (const entry of fs.readdirSync(path.join(directory,...parts),{withFileTypes:true})) {
   const next=[...parts,entry.name];
   if (entry.isDirectory()) walk(next);
   else if (entry.isFile()) result.push(next.join('/'));
   else throw Error('Unsupported bundled guidance entry: '+next.join('/'));
  }
 }
 walk([]);
 return result.sort();
}

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Validate the files on disk and read their actual MCP guidance without a model or remote worker. */
export async function verifyBundledGuidance({projectDir=projectRoot,appOutDir,asar=builderAsar(projectDir)}) {
 const archive=path.join(appOutDir,'resources','app.asar');
 const sourceRoot=path.join(projectDir,'agent','builtin-skills');
 const bundledRoot=path.join(appOutDir,'resources','studio-skills');
 const readAsar=name=>asar.extractFile(archive,path.normalize(name));
 const sourceVersion=JSON.parse(fs.readFileSync(path.join(projectDir,'package.json'),'utf8')).version;
 const packedVersion=JSON.parse(readAsar('package.json')).version;
 if (packedVersion!==sourceVersion) throw Error('The packaged guidance version differs from the source version');
 for (const file of guidanceModules) {
  if (!fs.readFileSync(path.join(projectDir,file)).equals(readAsar(file))) throw Error('Packaged guidance differs from source: '+file);
 }
 if (!readAsar('agent/providers/dsh-policy.mjs').equals(fs.readFileSync(path.join(appOutDir,'resources','studio-dsh','dsh-policy.mjs'))))
  throw Error('Packaged DeepSeek guidance differs from the application policy');
 const expected=fileNames(sourceRoot),actual=fileNames(bundledRoot);
 if (!expected.length||expected.length!==actual.length||expected.some((name,index)=>name!==actual[index]))
  throw Error('Packaged studio-skills inventory differs from source');
 const byDocument=new Map();
 for (const file of expected) {
  const bytes=fs.readFileSync(path.join(bundledRoot,file));
  if (!bytes.equals(fs.readFileSync(path.join(sourceRoot,file)))) throw Error('Packaged skill differs from source: '+file);
  byDocument.set(file,{bytes:bytes.length,sha256:sha256(bytes),text:bytes.toString('utf8')});
 }
 const map=JSON.parse(readAsar(mapPath));
 const service=new ScientificSkills({map,bundledRoot,studioRoot:projectDir,sources:()=>[],settings:()=>({}),setupAllowed:()=>true});
 const scope={provider:'deepseek'};
 const bundledIds=new Set(map.skills.filter(skill=>skill.source==='studio').map(skill=>skill.id));
 const routes=map.functions.filter(route=>route.skills.length&&route.skills.every(id=>bundledIds.has(id)));
 const observedDocuments=new Set();
 for (const route of routes) {
  const read=document_id=>service.call('read_scientific_skill',{function_id:route.id,...document_id?{document_id}:{}},scope);
  const entry=await read();
  if (entry.status!=='passed'||entry.function_id!==route.id||!entry.attachments.length)
   throw Error('Cannot read packaged skill route '+route.id+': '+(entry.reason||entry.status));
  for (const attachment of entry.attachments) {
   const expected=byDocument.get(attachment.name);
   if (!expected||attachment.sha256!==expected.sha256||attachment.bytes!==expected.bytes||!entry.text.includes(expected.text))
    throw Error('Packaged skill route delivered different content: '+route.id+' / '+attachment.name);
   observedDocuments.add(attachment.name);
  }
  for (const documentId of entry.document_ids) {
   if (entry.attachments.some(attachment=>attachment.name===documentId)) continue;
   const detail=await read(documentId), expected=byDocument.get(documentId);
   if (detail.status!=='passed'||!expected||detail.text!==expected.text||detail.attachments[0]?.sha256!==expected.sha256)
    throw Error('Cannot read packaged reference '+documentId+' for '+route.id+': '+(detail.reason||detail.status));
   observedDocuments.add(documentId);
  }
 }
 return {version:packedVersion,promptSha256:sha256(readAsar(prompt)),guidanceFiles:guidanceModules.length,skillFiles:expected.length,routes:routes.length,documents:observedDocuments.size};
}

if (process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
 try {
  if (process.argv.length!==3) throw Error('Usage: node scripts/check-bundled-guidance.mjs <unpacked-app-directory>');
  console.log(JSON.stringify(await verifyBundledGuidance({appOutDir:path.resolve(process.argv[2])}),null,2));
 } catch (error) {
  console.error('Packaged guidance check failed: '+error.message);
  process.exitCode=1;
 }
}
