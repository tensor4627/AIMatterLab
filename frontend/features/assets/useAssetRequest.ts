import {useEffect,useRef,useState} from 'react';

/** Scope displayed observations to their actual inputs; this does not cancel dispatched writes. */
export function useAssetRequest<T>(scope:string){
 const owner=useRef({scope,epoch:0,sequence:0,pending:false,mounted:true});
 if(owner.current.scope!==scope)owner.current={scope,epoch:owner.current.epoch+1,sequence:0,pending:false,mounted:owner.current.mounted};
 const [state,setState]=useState<{scope:string;epoch:number;value:T|null;pending:boolean;error:string;settled?:boolean}>({scope,epoch:owner.current.epoch,value:null,pending:false,error:''});
 useEffect(()=>{owner.current.mounted=true;return()=>{owner.current.mounted=false;owner.current.epoch++;owner.current.pending=false;};},[]);
 async function execute(action:()=>Promise<T>,onSuccess?:(value:T)=>void){
  const ticket=owner.current;if(!ticket.mounted||ticket.scope!==scope||ticket.pending)return;
  ticket.pending=true;const sequence=++ticket.sequence,epoch=ticket.epoch;
  const current=()=>owner.current===ticket&&ticket.mounted&&ticket.epoch===epoch&&ticket.sequence===sequence;
  setState({scope,epoch,value:null,pending:true,error:''});
  try{const value=await action();if(!current())return;setState({scope,epoch,value,pending:false,error:''});onSuccess?.(value);}
  catch(error){if(!current())return;setState({scope,epoch,value:null,pending:false,error:error instanceof Error?error.message:String(error)});}
  finally{ticket.pending=false;if(owner.current.mounted&&!current())setState(previous=>previous.scope===scope&&previous.epoch===epoch&&previous.pending?{...previous,pending:false,settled:true}:previous);}
 }
 const matches=state.scope===scope&&state.epoch===owner.current.epoch;
 return {execute,value:matches?state.value:null,pending:matches&&state.pending,error:matches?state.error:'',stale:!matches&&(state.value!==null||state.pending||!!state.error||!!state.settled),stalePending:!matches&&state.pending,staleSettled:!matches&&!!state.settled};
}
