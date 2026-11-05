import {TaskRecords as WorkspaceTaskRecords} from "../../backend/main/workspace/task-records.mjs";
import {formatPreparedTaskTurn} from "../context/task-turn-context.mjs";

export {structuredResult} from "../../backend/main/workspace/task-records.mjs";

/** Compatibility composition: workspace state first, then Agent-only text. */
export class TaskRecords extends WorkspaceTaskRecords{
 prepareTurn(provider,value){return formatPreparedTaskTurn(super.prepareTurnState(provider,value));}
}
