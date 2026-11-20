/** Current UI intent does not replace the user's current delegation or tool scope. */
export function interactionFlags({planningMode=false,reviewMode=false}={}){
 if(typeof planningMode!=='boolean'||typeof reviewMode!=='boolean')throw Error('Invalid interaction mode');
 return {planningMode,reviewMode};
}

export function interactionModeContext({planningMode=false,reviewMode=false,scope='chat'}={}){
 ({planningMode,reviewMode}=interactionFlags({planningMode,reviewMode}));
 if(!['chat','workflow','terminal','private-definition'].includes(scope))throw Error('Invalid interaction scope');
 const mode=reviewMode?'review':planningMode?'planning':scope==='workflow'?'workflow':'chat';
 const current='[AIMatterLab interaction mode: '+mode+']\nCurrent capability scope: '+scope+'.\nCurrent task planning checkbox: '+(planningMode?'enabled (planningMode=true)':'disabled (planningMode=false)')+'. This current request supersedes earlier messages, summaries and restored history about this setting. '+(planningMode?'Task planning is already enabled; do not tell the user to enable it again.':'Task planning is currently disabled; this does not discard an existing bound workflow.')+'\n';
 const boundary='Switching the checkbox keeps this conversation, its existing project authorization and its verified resource capabilities. Reuse the original authorized resource and its confirmed session workspace when the calculation continues there. A different project, resource or capability requires its own verification. Within the current user delegation and verified tool scope, continue editing, checking, building, running, diagnosing and retrying definitely failed attempts. Honor explicit draft-only/no-run/stop requests. Keep checks, execution state and authorization separate. Never replay an unconfirmed job or widen project/resource limits.';
 const guidance={
  chat:'Use the current authorized compute tools for resource leases, queue inspection, environment setup and explicitly delegated independent jobs. Prefer planning for a saved workflow when it fits the request.',
  terminal:'This turn uses an explicitly shared terminal. Continue within its current scope. Saving a managed workflow requires the intended service and its authorized authoring workspace.',
  'private-definition':'Only the explicitly shared current private definition is available. The checkbox does not expand that sharing to workflow files or other private data.',
  workflow:'Continue the existing workflow within its current authoring scope, even when the checkbox is off. When asked to plan and arrange execution, save the roadmap and real input references, prepare the authorized target and continue to the applicable execution review or submission step. The current request controls whether any calculation may be run. Create a separate workflow only at the user’s request.',
 };
 return current+guidance[scope]+'\n'+boundary;
}
