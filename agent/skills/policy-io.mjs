import {constants as fsConstants} from 'node:fs';
/** Interpose before every guidance file operation, including descriptor reads. */
const MUTATING=new Set(['writeFile','appendFile','copyFile','cp','mkdir','mkdtemp','rename','link','symlink','unlink','rm','rmdir','truncate','chmod','chown','lchmod','lchown','utimes','lutimes','futimes','createWriteStream']);
const WRITE_FLAGS=fsConstants.O_WRONLY|fsConstants.O_RDWR|fsConstants.O_CREAT|fsConstants.O_TRUNC|fsConstants.O_APPEND;
function baseName(label){return label.split('.').pop().replace(/Sync$/,'');}
function rejectsWrite(label,args){
 if(baseName(label)==='open'){
  const flags=args[1];
  if(typeof flags==='number')return (flags&WRITE_FLAGS)!==0;
  if(typeof flags==='string')return /[wa+]/.test(flags);
  return false;
 }
 return MUTATING.has(baseName(label));
}
/** Interpose before every guidance file operation, including descriptor reads. */
function wrapMethod(method,label,{policy,asynchronous,descriptors,check,handle}){
 const wrapped=new Proxy(method,{
  apply(target,thisArg,args){
   if(rejectsWrite(label,args)){
    const failure=Error('Guidance filesystem is read-only');
    if(asynchronous)return Promise.reject(failure);
    throw failure;
   }
   if(asynchronous)return (async()=>{
    await policy.revalidate();
    check(args[0]);
    const result=await target.apply(thisArg,args);
    if(label==='realpath'||label.endsWith('.realpath'))check(result);
    return label==='open'||label.endsWith('.open')?handle(result,args[0]):result;
   })();
   const file=typeof args[0]==='number'?descriptors.get(args[0]):args[0];
   check(file);
   const result=target.apply(thisArg,args);
   if(label==='openSync'||label.endsWith('.openSync'))descriptors.set(result,file);
   if(label==='realpathSync'||label.endsWith('.realpathSync'))check(result);
   return result;
  },
  // Some filesystem helpers expose sibling functions (e.g. realpathSync.native).
  get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?wrapMethod(value,label+'.'+String(key),{policy,asynchronous,descriptors,check,handle}):value;}
 });
 return wrapped;
}

export function policyIo(io,policy,{asynchronous=false}={}){
 const descriptors=new Map();
 const check=file=>{policy.assertCurrent();policy.assertReadable(file);};
 const handle=(value,file)=>new Proxy(value,{get(target,key){const method=Reflect.get(target,key,target);if(typeof method!=='function')return method;if(key==='close')return method.bind(target);return async(...args)=>{await policy.revalidate();check(file);return method.apply(target,args);};}});
 const options={policy,asynchronous,descriptors,check,handle};
 return new Proxy(io,{get(target,key){
  const value=Reflect.get(target,key,target);
  if(typeof value==='function'){
   if(key==='closeSync')return(...args)=>{descriptors.delete(args[0]);return value.apply(target,args);};
   return wrapMethod(value,String(key),options);
  }
  // `fs.promises` is a nested namespace of asynchronous path operations.
  if(key==='promises'&&value&&typeof value==='object')return policyIo(value,policy,{asynchronous:true});
  return value;
 }});
}
