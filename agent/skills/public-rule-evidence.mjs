import rawFs from 'node:fs/promises';import {policyIo} from './policy-io.mjs';import {createReadPolicy,legacyGuidanceFacts} from './read-policy.mjs';import path from 'node:path';import {constants} from 'node:fs';import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const relative=value=>typeof value==='string'&&value.length<=512&&/^[A-Za-z0-9_./-]+$/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!path.posix.isAbsolute(value);
export class PublicRuleEvidence{
 constructor(resolve){this.resolve=resolve;this.cache=new Map();}
 async inspect(document,{policy=createReadPolicy(legacyGuidanceFacts())}={}){
  const fs=policyIo(rawFs,policy,{asynchronous:true});policy.assertCurrent();
  const receipt=document?.source_receipt;if(!receipt)return null;
  const local=receipt.local_files;
  if(!Array.isArray(local)||local.length>64)throw Error('Invalid bounded planning-rule source receipt');
  const results=[];
  for(const item of local){
   if(!relative(item.path)||!digest(item.sha256)||(item.sha256_crlf!==undefined&&!digest(item.sha256_crlf))||
     (item.sha256_checkout!==undefined&&!digest(item.sha256_checkout)))throw Error('Invalid planning-rule source file');
   const configured=this.resolve(item.source_id,{policy});
   if(typeof configured!=='string'||!path.isAbsolute(configured)){results.push({source_id:item.source_id,path:item.path,status:'unregistered'});continue;}
   try{
    policy.assertReadable(path.join(configured,...item.path.split('/')));
    const root=await fs.realpath(configured),target=path.join(root,...item.path.split('/'));
    if(await fs.realpath(target)!==target)throw Error('Linked source');
    const before=await fs.lstat(target,{bigint:true});
    if(!before.isFile()||before.isSymbolicLink()||before.size>2n*1024n*1024n)throw Error('Source unavailable or oversized');
    const key=target+'\0'+['dev','ino','size','mtimeNs','ctimeNs'].map(k=>before[k]).join(':');
    let actual=this.cache.get(key);
    if(!actual){
     const fd=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
     try{
      const opened=await fd.stat({bigint:true});if(['dev','ino','size','mtimeNs','ctimeNs'].some(k=>opened[k]!==before[k]))throw Error('Source changed while opening');
      const data=await fd.readFile(),after=await fd.stat({bigint:true});
      if(data.length!==Number(before.size)||['dev','ino','size','mtimeNs','ctimeNs'].some(k=>after[k]!==before[k])||await fs.realpath(target)!==target)throw Error('Source changed while reading');
      actual=sha(data);if(this.cache.size>256)this.cache.clear();this.cache.set(key,actual);
     }finally{await fd.close();}
    }
    // Keep the bytes observed on disk. Only an explicitly recorded digest can match.
    const crlfMatch=actual===item.sha256_crlf;
    const checkoutMatch=actual===item.sha256_checkout;
    const variant=crlfMatch?'crlf':checkoutMatch?'observed_checkout':undefined;
    results.push({source_id:item.source_id,path:item.path,status:actual===item.sha256||variant?'matched':'stale',expected_sha256:item.sha256,actual_sha256:actual,
     ...(item.sha256_crlf!==undefined&&{expected_sha256_crlf:item.sha256_crlf}),
     ...(item.sha256_checkout!==undefined&&{expected_sha256_checkout:item.sha256_checkout}),...(variant&&{matched_variant:variant})});
   }catch{results.push({source_id:item.source_id,path:item.path,status:'blocked'});}
  }
  await policy.revalidate();
  return {status:results.length&&results.every(r=>r.status==='matched')?'source_matched_reference':'reference_only',files:results,scope:'Source identity only. Current executable/runtime, scientific applicability and safe defaults are not established. Mismatch or unavailable source forbids treating reference defaults as current effective settings.'};
 }
}
