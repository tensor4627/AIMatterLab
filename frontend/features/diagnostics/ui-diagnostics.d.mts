import type {NoticeSeverity} from '../../ui/Notice';

export interface DiagnosticContext {operation:string;taskId:string;provider?:string|null;threadId?:string|null;inputParameters?:Record<string,unknown>;taskName:string;parameterRevision:number;deploymentRevision:number;target:string;targetId:string;targetName:string;projectId:string;runId:string|null;preparedId:string|null;requestId:string|null;configuration:string;executionBefore:string;taskVersion:any;phase:string}

export interface UiDiagnostic {id:string;observedAt:number;raw:string;stack:string|null;context:DiagnosticContext|null;severity?:NoticeSeverity;resolution?:{phase:string;observedAt:number;execution:any}}

export function diagnosticContext(task:any,config:any,operation:string,runId?:string|null,targetName?:string):DiagnosticContext;

export function executionNotStarted(error:unknown):boolean;

export function createDiagnostic(error:unknown,context?:DiagnosticContext|null,severity?:NoticeSeverity):UiDiagnostic;

export function diagnosticPhase(record:UiDiagnostic,task?:any):string;

export function diagnosticPending(phase:string):boolean;

export function diagnosticSeverity(record:UiDiagnostic,phase:string):NoticeSeverity;

export function diagnosticCurrent(record:UiDiagnostic,task:any,config:any):boolean;

export function diagnosticSummary(record:UiDiagnostic,phase?:string):string;

export interface DiagnosticJournal {add(error:unknown,context:DiagnosticContext):UiDiagnostic;list(taskId:string):UiDiagnostic[];reconcile(task:any):UiDiagnostic[]}

export function createDiagnosticJournal():DiagnosticJournal;

export const deploymentDiagnosticJournal:DiagnosticJournal;
