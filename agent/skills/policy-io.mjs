/** Interpose before every guidance file operation, including descriptor reads. */
function wrapMethod(method,label,{policy,asynchronous,descriptors,check,handle}){
 const wrapped=new Proxy(method,{
  apply(target,thisArg,args){
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
