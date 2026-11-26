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
  workflow:[
   'Continue the existing workflow within its current authoring scope, even when the checkbox is off. When asked to plan and arrange execution, save the roadmap and real input references, prepare the authorized target and continue to the applicable execution review or submission step. The current request controls whether any calculation may be run. Create a separate workflow only at the user’s request.',
   'For missing non-file scientific parameters, first use version-matched manuals, inspected inputs and evidence-based inference. Search public documentation or literature when the result is uncertain or the user requests research. Honor offline or internal-only requests. Check applicability to the actual system and cite the evidence for selected values. Preserve explicit user choices. If uncertainty remains or research is unavailable, keep the field blank and editable in steps and list its key in missing_fields when saving with present_task. Continue filling independent fields.',
   'For a user-named desktop directory use find_local_input_files. Use import_workflow_input for its selected file, an explicit desktop file, or a public HTTPS data download. Use copy_project_inputs for files on the selected SSH worker. Put the verified saved path in its proper file field and parameters.files.',
   'Generate required control files such as run.in or nep.in from the user’s goal, resolved parameters, actual input basenames and the selected software version. Save with write_project_input and read the result back with read_project_input. Bind that path in the control-file field and parameters.files. When a needed decision is still unresolved, keep it editable and report the draft state. On requested changes, synchronize the real control file with the current form values.',
  ].join('\n'),
 };
 const progress='For an action request, take the next available authorized step before reporting status. If a step is blocked, continue independent work, such as inspecting the original target or preparing the remaining inputs. Report the latest observed change or receipt and any exact decision needed to continue. Follow the tool receipt to distinguish a rejected step from a dispatched action awaiting confirmation.';
 return current+guidance[scope]+'\n'+boundary+'\n'+progress;
}
