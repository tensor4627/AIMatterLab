/** Interpose before every guidance file operation, including descriptor reads. */
export function policyIo(io,policy,{asynchronous=false}={}){
 const descriptors=new Map();
 const check=file=>{policy.assertCurrent();policy.assertReadable(file);};
 const handle=(value,file)=>new Proxy(value,{get(target,key){const method=Reflect.get(target,key,target);if(typeof method!=='function')return method;if(key==='close')return method.bind(target);return async(...args)=>{await policy.revalidate();check(file);return method.apply(target,args);};}});
 return new Proxy(io,{get(target,key){
  const method=Reflect.get(target,key,target);if(typeof method!=='function')return method;
  if(key==='closeSync')return(...args)=>{descriptors.delete(args[0]);return method.apply(target,args);};
  if(asynchronous)return async(...args)=>{await policy.revalidate();check(args[0]);const result=await method.apply(target,args);if(key==='realpath')check(result);return key==='open'?handle(result,args[0]):result;};
  return(...args)=>{const file=typeof args[0]==='number'?descriptors.get(args[0]):args[0];check(file);const result=method.apply(target,args);if(key==='openSync')descriptors.set(result,file);if(key==='realpathSync')check(result);return result;};
 }});
}
