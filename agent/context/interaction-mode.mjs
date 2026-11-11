/** Current UI intent is separate from tool scope and human execution approval. */
export function interactionFlags({planningMode=false,reviewMode=false}={}){
 if(typeof planningMode!=='boolean'||typeof reviewMode!=='boolean')throw Error('Invalid interaction mode');
 return {planningMode,reviewMode};
}

export function interactionModeContext({planningMode=false,reviewMode=false,scope='chat'}={}){
 ({planningMode,reviewMode}=interactionFlags({planningMode,reviewMode}));
 if(!['chat','workflow','terminal','private-definition'].includes(scope))throw Error('Invalid interaction scope');
 const mode=reviewMode?'review':planningMode?'planning':scope==='workflow'?'workflow':'chat';
 const current='[Studio interaction mode: '+mode+']\nCurrent capability scope: '+scope+'.\nCurrent task planning checkbox: '+(planningMode?'enabled (planningMode=true)':'disabled (planningMode=false)')+'. This current request supersedes earlier messages, summaries and restored history about this setting. '+(planningMode?'Task planning is already enabled; do not tell the user to enable it again.':'Task planning is currently disabled; this does not discard an existing bound workflow.')+'\n';
 const boundary='The checkbox does not grant project/file access, terminal ownership or scientific execution approval. Never validate, build, train, execute or submit a calculation, including through GPUMD, Slurm or terminal commands; human review and execution approval remain separate.';
 const access=scope==='terminal'?'This turn has only the explicitly handed-off terminal capability. Planning discussion and draft design may continue in conversation, but formal workflow authoring tools and an authorized worker authoring workspace are unavailable on this selected resource. Explain that precise limitation when a saved workflow is requested; the human must select/connect the intended workflow service. Do not switch workers, create a workflow or broaden the terminal grant automatically.':scope==='private-definition'?'Only the explicitly shared current private definition is available. The checkbox does not expand that sharing to workflow files or other private data.':scope==='workflow'?'Continue the one existing bound workflow within its current authoring scope, even when the checkbox is off. Never create a replacement workflow implicitly.':planningMode?'No workflow is bound to this message. Discuss the design and identify the missing authorized workflow/tool context; do not create a workflow implicitly.':'Use conversation and authorized read-only inspection; a new computation requires task planning and an authorized workflow context.';
 return current+access+'\n'+boundary;
}
