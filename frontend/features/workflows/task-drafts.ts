import {clearTaskSessionDrafts} from '../../ui/session-drafts';
import {deleteTaskPygasDrafts} from '../pygas/pygas-local-draft';
import {deleteWorkflowOutbox} from './draft-outbox.mjs';

/** Clear only a task confirmed deleted by the desktop; ignore its later draft writes. */
export function clearTaskDrafts(taskId:string){
 if(!taskId)return;
 clearTaskSessionDrafts(taskId);
 deleteTaskPygasDrafts(taskId);
 deleteWorkflowOutbox(taskId,localStorage);
}
