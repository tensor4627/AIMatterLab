import {createFollowUpQueue} from '../../agent/sessions/follow-up-queue.mjs';
import {workspaceContextHeader} from '../../contracts/agent/user-message.mjs';
import {explicitNewWorkflow} from '../../contracts/agent/workflow-intent.mjs';
import {splitApiModelKey} from '../../contracts/agent/model-profiles.mjs';
import {createWorkflowDraft} from '../../backend/main/workspace/routes.mjs';
import {attachmentPrompt} from '../../contracts/agent/chat-attachments.mjs';

export function desktopFollowUpQueue({
 catalog, agents, records, worker, workflowContext, resourceRouting, authoringAuthorization,
 request, publish, validateFiles, confirmCodexDelivery
}) {
 const draftPorts = {records, catalog, worker, workflowContext, authoringAuthorization};

 function conversation({provider, threadId}) {
  const value = records.conversation(provider, threadId);
  if (!value || records.deleted(provider, threadId)) throw Error('A saved original conversation is required');
  return value;
 }

 function capture(owner, item) {
  const selected = conversation(owner);
  const api = splitApiModelKey(item.model);
  const modelProfile = api ? agents.modelProfiles.read(api.profileId) : null;
  if (modelProfile && modelProfile.provider !== owner.provider) throw Error('Queued model profile belongs to another provider');
  return {
   provider: owner.provider, threadId: owner.threadId, projectId: selected.projectId ?? null,
   modelProfile: modelProfile ? {id: modelProfile.id, revision: modelProfile.revision} : null,
   binding: resourceRouting.followUpBinding(owner.provider, owner.threadId),
  };
 }

 async function dispatch(owner, item, queued) {
  const {provider, threadId} = owner;
  if (queued.mode === 'steer') return request({provider, method: 'turn/steer', params: {
   threadId, expectedTurnId: queued.targetTurnId, clientUserMessageId: item.id,
   planningMode: item.planningMode, input: [{type: 'text', text: item.text}],
  }}, {queued});

  return agents.runInConversation(provider, threadId, async () => {
   queued.assertCurrent();
   const selected = conversation(owner);
   const text = item.text.trim()?item.text:attachmentPrompt(item.files);
   let taskId = selected.taskId;
   if (item.preparedTaskId && item.preparedTaskId !== taskId) throw Error('The prepared queued workflow is no longer bound to this conversation');
   const fresh = item.newWorkflow || explicitNewWorkflow(item.text);
   const selection = item.scope.binding.selection;
   const terminalOnly = selection && resourceRouting.workerSelected(provider, threadId) !== true;
   if ((item.planningMode || fresh) && !item.preparedTaskId && !terminalOnly) {
    if (fresh) queued.beforeTaskCreation();
    const task = createWorkflowDraft(draftPorts, {
     provider, threadId, projectId: selected.projectId, request: text,
     workflowVersion: 2, planningMode: true, newWorkflow: fresh,
    });
    if (fresh) queued.taskPrepared(task.id);
    taskId = task.id;
   }
   queued.assertCurrent();
   const input = [{type: 'text', text}];
   if (item.context) input.push({type: 'text', text: workspaceContextHeader + '\n' + item.context});
   if (item.skill?.path) input.push({type: 'skill', name: item.skill.name, path: item.skill.path});
   return request({provider, method: 'turn/start', params: {
    threadId, clientUserMessageId: item.id, studioTurnRequestId: item.id, input, planningMode: item.planningMode,
    ...(item.model ? {model: item.model} : {}), ...(item.effort ? {effort: item.effort} : {}),
    ...(taskId ? {studioTaskId: taskId} : {}), ...(item.skill?.functionId ? {studioSkillId: item.skill.functionId} : {}),
    ...(item.files?.length ? {studioAttachments: item.files.map(file => file.id)} : {}),
   }}, {queued});
  }, {claimTurn: true});
 }

 async function reconcile(owner, item) {
  const {provider, threadId} = owner;
  conversation(owner);
  if (provider === 'codex' && confirmCodexDelivery) return confirmCodexDelivery(owner, item.id);
  const result = await request({provider, method: 'thread/read', params: {threadId, includeTurns: true}});
  if (result?.thread?.id !== threadId) return null;
  return result.thread.turns?.find(turn =>
   (turn.status === 'completed' || turn.lateReceipt?.status === 'completed' ||
    provider === 'codex' && ['failed', 'interrupted'].includes(turn.status)) &&
   turn.items?.some(entry => entry.type === 'userMessage' &&
    (entry.id === item.id || entry.clientUserMessageId === item.id || provider === 'codex' && entry.clientId === item.id))
  )?.id ?? null;
 }

 return createFollowUpQueue({
  catalog, agents, capture, dispatch, reconcile, publish, validateFiles,
  interrupt: ({provider, threadId}, turnId) => request({provider, method: 'turn/interrupt', params: {threadId, turnId}}),
 });
}
