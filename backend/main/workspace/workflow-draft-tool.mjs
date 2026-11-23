import taskDraftSchema from '../../../contracts/workflows/task-draft.schema.json' with {type:'json'};
import roadmapSchema from '../../../contracts/workflows/roadmap.schema.json' with {type:'json'};
import {normalizeInlineSchema, validateToolJson} from '../../../contracts/tools/tool-package.mjs';
import {normalizeSteps} from '../../../contracts/workflows/task-fields.mjs';
import {validateRoadmap} from '../../../contracts/workflows/roadmap.mjs';

const {$id, ...roadmap} = roadmapSchema;
const inputSchema = {...taskDraftSchema, properties:{...taskDraftSchema.properties, roadmap}};
const stepSchema = taskDraftSchema.properties.steps.items.anyOf[1];

export const conversationDraftTool = {
  name:'present_task',
  description:'Save the current conversation-owned calculation draft and optional workflow roadmap. Use the supplied task_id, actual input paths, and known values. List inputs the user still needs to supply. This saves a draft without reading files, approving execution, or submitting a job.',
  inputSchema,
  annotations:{readOnlyHint:false, destructiveHint:false},
};

// Drafts with an authoring binding still go through that worker and its
// private input/definition policy. A new managed draft is desktop-owned.
export function isConversationDraft(task) {
  return task?.workflowVersion === 2 && !task.authoring && !task.workspace && !task.inputBinding && !task.customCv && !task.composition;
}

export function createConversationDraftTool({records, assertScope}) {
  const starting = new Map();
  return {
    async withPlanningThreadStart(session, start) {
      if (!session?.id || session.threadId !== null) return start();
      starting.set(session.id, session);
      try { return await start(); }
      finally { if (starting.get(session.id) === session) starting.delete(session.id); }
    },
    list(scope) {
      if (!scope.sessionId) return null;
      // Codex indexes tool schemas while creating the native thread, before it
      // returns the ID used to bind a task. Calls still require the saved owner.
      if (!scope.threadId && !scope.taskId && starting.get(scope.sessionId)?.provider === scope.provider)
        return {tools:[conversationDraftTool]};
      if (!scope.threadId || !scope.taskId) return null;
      const task = records.bound(scope.provider, scope.threadId);
      return task?.id === scope.taskId && isConversationDraft(task) ? {tools:[conversationDraftTool]} : null;
    },
    call(args, scope) {
      let value;
      try {
        const task = assertScope(scope);
        if (!isConversationDraft(task) || args.task_id !== task.id) throw Error('The draft must belong to this conversation');
        validateToolJson(args);
        value = normalizeInlineSchema(args, inputSchema, 'present_task');
        if (!value.name.trim() || value.missing_fields.some(field => !field.trim())) throw Error('Invalid task name or missing requirements');
        for (const step of value.steps) if (typeof step !== 'string') normalizeInlineSchema(step, stepSchema, 'present_task.steps');
        normalizeSteps(value.steps, value.parameters, value.missing_fields);
        if (Object.hasOwn(value, 'roadmap')) validateRoadmap(value.roadmap);
        assertScope(scope);
      } catch (error) {
        throw Object.assign(error, {operationNotStarted:true});
      }
      const saved = records.presentDraft(scope.provider, scope.threadId, value);
      return {status:'draft', task_id:saved.id, parameter_revision:saved.parameterRevision, has_roadmap:!!saved.roadmap,
        missing_fields:saved.missingFields};
    }
  };
}
