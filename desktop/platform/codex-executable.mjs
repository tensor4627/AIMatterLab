import fs from 'node:fs';
import path from 'node:path';

function installedRoot({platform=process.platform,localAppData=process.env.LOCALAPPDATA}={}){
 if(platform!=='win32'||typeof localAppData!=='string'||!path.isAbsolute(localAppData)||/^[\\/]{2}/.test(localAppData))return null;
 return path.join(localAppData,'OpenAI','Codex','bin');
}

function stat(file,fileSystem){
 try{return fileSystem.lstatSync(file);}catch{return null;}
}

function installedCandidate(options={}){
 const root=installedRoot(options),fileSystem=options.fileSystem??fs;
 if(!root)return null;
 let entries;
 try{entries=fileSystem.readdirSync(root);}catch{return null;}
 const candidates=[];
 for(const entry of entries){
  const directory=path.join(root,entry);
  if(!stat(directory,fileSystem)?.isDirectory())continue;
  const file=path.join(directory,'codex.exe'),info=stat(file,fileSystem);
  if(info?.isFile())candidates.push({file,mtime:info.mtimeMs});
 }
 candidates.sort((a,b)=>b.mtime-a.mtime||a.file.localeCompare(b.file));
 return candidates[0]?.file??null;
}

export function findInstalledCodex(options={}){
 return installedCandidate(options)??'codex';
}

function checkedExecutable(value){
 if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f\u007f]/.test(value))throw Error('Invalid Codex executable path');
 if(/\.(?:cmd|bat|ps1)$/i.test(value))throw Error('Select a Codex executable, not a shell wrapper');
 return value;
}

export function resolveCodexExecutable(executable,options={}){
 checkedExecutable(executable);
 const root=installedRoot(options);
 if(!root||!path.isAbsolute(executable))return executable;
 const relative=path.relative(root,path.resolve(executable));
 const parts=relative.split(path.sep);
 if(parts.length!==2||!parts[0]||parts[0]==='..'||parts[1].toLowerCase()!=='codex.exe')return executable;
 const fileSystem=options.fileSystem??fs;
 // An inaccessible path, directory or symlink remains pinned for the real version probe.
 try{fileSystem.lstatSync(executable);return executable;}catch(error){if(error.code!=='ENOENT')return executable;}
 return installedCandidate(options)??executable;
}
