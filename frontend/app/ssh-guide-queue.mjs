/** Pure queueing for SSH authentication guide requests. */
export function sshGuideKey(request){
 if(!request||typeof request!=='object')return '';
 if(request.kind==='original-run')return 'original-run:'+String(request.runId||'')+':'+String(request.taskId||'');
 return 'saved-profile:'+String(request.clusterId||'')+':'+String(request.version??'');
}

export function enqueueSshGuide(current,queued,next){
 if(!current)return {current:next,queued:null};
 if(sshGuideKey(current.request)===sshGuideKey(next.request))return {current,queued};
 return {current,queued:next};
}

export function takeQueuedSshGuide(current,queued){
 if(current||!queued)return {current,queued:null};
 return {current:queued,queued:null};
}
