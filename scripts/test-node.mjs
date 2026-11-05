// Node engineering tests only. Native/scientific acceptance remains explicitly invoked.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const repository=fileURLToPath(new URL('..',import.meta.url));

export function discoverNodeTests(directory=path.join(repository,'tests'),{maxFiles=4096,maxDepth=12}={}){
 if(!Number.isInteger(maxFiles)||maxFiles<1||maxFiles>100000||!Number.isInteger(maxDepth)||maxDepth<0||maxDepth>64)throw Error('Invalid test discovery bounds');
 const root=path.resolve(directory),files=[];
 function visit(current,depth){
  if(depth>maxDepth)throw Error('Node test discovery exceeded its depth bound');
  if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked Node test directory refused: '+current);
  for(const entry of fs.readdirSync(current,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
   const file=path.join(current,entry.name);
   if(entry.isSymbolicLink())throw Error('Linked Node test input refused: '+file);
   if(entry.isDirectory())visit(file,depth+1);
   else if(entry.isFile()&&entry.name.endsWith('.test.mjs')){files.push(file);if(files.length>maxFiles)throw Error('Node test discovery exceeded its file bound');}
  }
 }
 visit(root,0);return files;
}

export function runNodeTests(args=process.argv.slice(2),{testsRoot=path.join(repository,'tests'),cwd=repository}={}){
 const files=discoverNodeTests(testsRoot);
 if(args.includes('--list')){
  if(args.length!==1)throw Error('--list must be used by itself');
  for(const file of files)process.stdout.write(path.relative(cwd,file).replaceAll('\\','/')+'\n');
  return 0;
 }
 if(!files.length)throw Error('No Node engineering tests discovered');
 const result=spawnSync(process.execPath,['--test',...args,...files],{cwd,stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.signal){process.kill(process.pid,result.signal);return 1;}
 return result.status??1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{process.exitCode=runNodeTests();}catch(error){console.error(error.stack||String(error));process.exitCode=1;}
}
