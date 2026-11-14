/** The PTY owns the cumulative acknowledgement. Only successful writes advance a local view. */
export function createHumanInputWriter() {
 let epoch,accepted=0;
 return async function write(send,session,requestId,data){
  const base=session.humanInputSequence;
  if(Number.isSafeInteger(base)){
   if(epoch!==session.ownerEpoch){epoch=session.ownerEpoch;accepted=0;}
   const inputSequence=Math.max(accepted,base)+1;
   const result=await send({sessionId:session.sessionId,ownerEpoch:epoch,requestId,data,inputSequence});
   if(result?.accepted!==true||result.inputSequence!==inputSequence)throw Error('terminal_input_unconfirmed');
   accepted=inputSequence;
  }else await send({sessionId:session.sessionId,ownerEpoch:session.ownerEpoch,requestId,data});
 };
}
