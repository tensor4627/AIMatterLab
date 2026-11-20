import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lookup} from 'node:dns/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {openPublicSoftware,publicAddress,publicSoftwareUrl} from '../tools/public-software-docs.mjs';

const exec=promisify(execFile);
const CHUNK=1024*1024;
const MAX_PACKAGE=1024*1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');

async function streamRelease(source,file,open) {
 const {response}=await open(source.url,{signal:AbortSignal.timeout(180000)});
 const handle=await fs.open(file,'wx',0o600);
 let size=0;
 try{
  for await(const chunk of response){
   size+=chunk.length;
   if(size>MAX_PACKAGE)throw Error('Release exceeds the transfer budget');
   await handle.writeFile(chunk);
  }
 }finally{response.destroy();await handle.close();}
}

async function bundleRelease(source,dir,file,run=exec) {
 const url=publicSoftwareUrl(source.url);
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=await lookup(host,{all:true});
 if(!addresses.length||addresses.some(address=>!publicAddress(address.address)))throw Error('Use a Git release from a public endpoint');
 if(!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(source.commit))throw Error('The Git release must have a full commit ID');
 const nullFile=process.platform==='win32'?'NUL':'/dev/null';
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 Object.assign(env,{GIT_CONFIG_GLOBAL:nullFile,GIT_CONFIG_SYSTEM:nullFile,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:'https'});
 const resolve=host+':443:'+addresses.map(({address,family})=>family===6?'['+address+']':address).join(',');
 const git=async(...args)=>(await run('git',['-c','credential.helper=','-c','core.askPass=','-c','http.followRedirects=false',
  '-c','http.curloptResolve='+resolve,'-c','core.hooksPath='+nullFile,...args],{cwd:dir,env,timeout:80000,maxBuffer:1024*1024,windowsHide:true})).stdout.trim();
 await git('init','--bare','--quiet',...source.commit.length===64?['--object-format=sha256']:[]);
 await git('fetch','--quiet','--no-tags','--',url.href,source.commit);
 if(await git('rev-parse','FETCH_HEAD')!==source.commit)throw Error('The fetched Git commit differs from the review');
 await git('update-ref','refs/heads/aimatterlab-transfer',source.commit);
 await git('bundle','create',file,'refs/heads/aimatterlab-transfer');
}

export async function withDesktopRelease(source,accept,{open=openPublicSoftware}={}) {
 const tempRoot=await fs.realpath(os.tmpdir());
 const directory=await fs.mkdtemp(path.join(tempRoot,'aimatterlab-tool-'));
 const file=path.join(directory,'release');
 try{
  if(source.kind==='git')await bundleRelease(source,directory,file);
  else await streamRelease(source,file,open);
  return await accept(file);
 }finally{
  if(path.dirname(await fs.realpath(directory))===tempRoot)await fs.rm(directory,{recursive:true,force:true});
 }
}

async function chunkAt(handle,offset,size) {
 const length=Math.min(CHUNK,size-offset), bytes=Buffer.alloc(length);
 let read=0;
 while(read<length){
  const result=await handle.read(bytes,read,length-read,offset+read);
  if(!result.bytesRead)throw Error('Release file changed during transfer');
  read+=result.bytesRead;
 }
 return bytes;
}

async function openRelease(file,read) {
 const handle=await fs.open(file,'r');
 try{
  const initial=await handle.stat();
  if(!initial.isFile()||initial.size<=0||initial.size>MAX_PACKAGE)throw Error('Choose a regular release file within the transfer budget');
  const same=async()=>{
   const observed=await handle.stat();
   if(['size','mtimeMs','ctimeMs','ino','dev'].some(key=>observed[key]!==initial[key]))throw Error('Release file changed during transfer');
  };
  const hash=createHash('sha256');
  for(let offset=0;offset<initial.size;offset+=CHUNK)hash.update(await chunkAt(handle,offset,initial.size));
  await same();
  const checksum=hash.digest('hex');
  return await read(handle,initial.size,checksum,same);
 }finally{await handle.close();}
}

export async function inspectDesktopSource(file,kind) {
 return openRelease(file,async(handle,size,checksum,same)=>{
  const limit=Math.min(size,16*1024);
  const first=await chunkAt(handle,0,limit);
  let text;
  try{
   if(!first.includes(0))text=new TextDecoder('utf-8',{fatal:true}).decode(first,{stream:limit<size}).replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
  }catch{ /* The file may be a binary executable or release archive. */ }
  await same();
  return {kind,name:path.basename(file),size,sha256:checksum,...text?{text,truncated:limit<size}:{}};
 });
}

export async function transferRelease(file,source,request,{acquired=()=>{}}={}) {
 return openRelease(file,async(handle,size,checksum,same)=>{
  if(source.sha256&&source.sha256!==checksum)throw Error('Release checksum differs from the reviewed version');
  acquired();
  const ticket={size,sha256:checksum};
  const position=await request('upload-offset',ticket);
  let offset=position?.offset;
  if(!Number.isSafeInteger(offset)||offset<0||offset>size)throw Error('The worker returned an invalid release resume position');
  while(offset<size){
   const bytes=await chunkAt(handle,offset,size);
   const receipt=await request('upload-chunk',{...ticket,offset,chunk:bytes.toString('base64'),chunk_sha256:sha(bytes)});
   if(receipt?.offset!==offset+bytes.length)throw Error('The worker did not confirm the transferred release bytes');
   offset=receipt.offset;
  }
  await same();
  return request('upload-finish',ticket);
 });
}
