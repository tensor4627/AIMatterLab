import type {AgentProvider} from '../../../contracts/dto/agent';
import type {UiDiagnostic} from './ui-diagnostics.mjs';
export interface DiagnosticRepairRequest {taskId:string;provider:AgentProvider;threadId:string;text:string}
export function diagnosticRepairRequest(record:UiDiagnostic,task:any,run?:any):DiagnosticRepairRequest|null;
