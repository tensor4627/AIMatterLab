/** Await desktop-owned connection cleanup before Electron completes a normal quit. */
export function installDesktopShutdown({app,begin,cleanup,timeoutMs=6500}){
 let pending=null,finished=false,resuming=false;
 function run(){
  if(pending)return pending;
  // This fence must be synchronous: no new renderer or tool work may enter
  // between the quit request and the first asynchronous cleanup operation.
  begin();
  pending=(async()=>{
   let timer;
   const work=Promise.resolve().then(cleanup).then(value=>({status:value?.status==='unconfirmed'?'unconfirmed':'closed'}),()=>({status:'unconfirmed'}));
   try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'unconfirmed'}),timeoutMs);})]);}
   finally{clearTimeout(timer);finished=true;}
  })();
  return pending;
 }
 const beforeQuit=event=>{
  if(finished)return;
  event.preventDefault();
  void run().then(()=>{if(!resuming){resuming=true;app.quit();}});
 };
 app.on('before-quit',beforeQuit);
 return {run};
}
