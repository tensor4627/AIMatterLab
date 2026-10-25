// Bounded polling for observations only. Never use for writes, prepare or submit.
export class ObservedRead {
 constructor(read,publish,{delay=2500,maxFailures=3,now=Date.now,schedule=(fn,ms)=>setTimeout(fn,ms),unschedule=id=>clearTimeout(id)}={}){
  this.read=read;this.publish=publish;this.delay=delay;this.maxFailures=maxFailures;this.now=now;this.schedule=schedule;this.unschedule=unschedule;
  this.state={value:null,observedAt:null,error:null,pending:false,connected:false,failures:0,paused:false};this.epoch=0;this.flight=null;this.timer=null;this.disposed=false;
 }
 emit(patch){this.state={...this.state,...patch};if(!this.disposed)this.publish(this.state);}
 clearTimer(){if(this.timer!==null)this.unschedule(this.timer);this.timer=null;}
 setConnected(connected){
  if(this.disposed||this.state.connected===connected)return;
  this.clearTimer();this.epoch++;this.flight=null;this.emit({connected,pending:false,paused:false,failures:0});
  if(connected)void this.refresh();
 }
 refresh(manual=true){
  if(this.disposed||!this.state.connected)return Promise.resolve();
  if(this.flight)return this.flight.promise;
  this.clearTimer();const epoch=this.epoch,flight={promise:null};this.flight=flight;
  this.emit({pending:true,...manual?{failures:0,paused:false}:{}});
  flight.promise=Promise.resolve().then(()=>this.read()).then(value=>{
   if(this.disposed||epoch!==this.epoch)return;
   this.emit({value,observedAt:this.now(),error:null,failures:0,paused:false});
  },error=>{
   if(this.disposed||epoch!==this.epoch)return;
   const failures=this.state.failures+1;this.emit({error:String(error?.message||error),failures,paused:failures>=this.maxFailures});
  }).finally(()=>{
   if(this.disposed||epoch!==this.epoch||this.flight!==flight)return;
   this.flight=null;this.emit({pending:false});
   if(this.state.connected&&!this.state.paused)this.timer=this.schedule(()=>{this.timer=null;void this.refresh(false);},this.delay*Math.min(4,2**this.state.failures));
  });
  return flight.promise;
 }
 dispose(){this.disposed=true;this.epoch++;this.clearTimer();this.flight=null;}
}
