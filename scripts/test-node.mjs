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

export const nodeSuites=['agent','backend','contracts','desktop','frontend','integration'];

export function selectNodeTests(args,files,{testsRoot,cwd}){
 const suites=new Set(),requested=new Set(),forward=[];let list=false,help=false;
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--list'){list=true;continue;}
  if(arg==='--help'){help=true;continue;}
  if(arg==='--suite'||arg.startsWith('--suite=')){
   const value=arg==='--suite'?args[++i]:arg.slice(8);
   for(const name of String(value||'').split(',')){if(!nodeSuites.includes(name))throw Error('Unknown local Node suite: '+name);suites.add(name);}continue;
  }
  if(arg==='--file'||arg.startsWith('--file=')){
   const value=arg==='--file'?args[++i]:arg.slice(7);if(!value)throw Error('--file needs a repository-relative test path');
   const file=path.resolve(cwd,value);if(!files.includes(file))throw Error('Not a discovered local Node test: '+value);requested.add(file);continue;
  }
  forward.push(arg);
 }
 const selected=files.filter(file=>(!suites.size||suites.has(path.relative(testsRoot,file).split(path.sep)[0]))&&(!requested.size||requested.has(file)));
 if(!help&&!selected.length)throw Error('No local Node tests matched the selection');
 return {files:selected,forward,list,help};
}

export function runNodeTests(args=process.argv.slice(2),{testsRoot=path.join(repository,'tests'),cwd=repository,spawnTarget=spawnSync,write=value=>process.stdout.write(value)}={}){
 const selection=selectNodeTests(args,discoverNodeTests(testsRoot),{testsRoot,cwd});
 if(selection.help){write('Local AIMatterLab Node tests (no scientific runs):\n  node scripts/test-node.mjs [--suite='+nodeSuites.join(',')+'] [--file=tests/path.test.mjs] [--list] [--test-name-pattern=pattern]\nNo selection runs every discovered test. Suites may be combined; each file runs once.\n');return 0;}
 const {files}=selection;
 if(selection.list){
  for(const file of files)write(path.relative(cwd,file).replaceAll('\\','/')+'\n');
  return 0;
 }
 if(!files.length)throw Error('No Node engineering tests discovered');
 const result=spawnTarget(process.execPath,['--test',...selection.forward,...files],{cwd,stdio:'inherit',env:process.env,windowsHide:true});
 if(result.error)throw result.error;
 if(result.signal){process.kill(process.pid,result.signal);return 1;}
 return result.status??1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{process.exitCode=runNodeTests();}catch(error){console.error(error.stack||String(error));process.exitCode=1;}
}
