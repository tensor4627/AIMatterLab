/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export interface LocalReviewEntry { id:string;name:string;path:string;sha256:string;size:number;role:string;binary?:boolean; }
export interface LocalReviewInspection {taskId:string;snapshotId:string;scope:'local-human-input-review-v1';parameterRevision:number;engine:'pygas.build'|'bias.validate'|'gpumd.sampling';entries:LocalReviewEntry[];parameters:Record<string,unknown>;steps:unknown[];graph:unknown;runtimeReceiptSha:string|null;targetConfirmationRequired?:boolean;validationPlan?:{device:string;fdStep:number;fdAtol:number;fullCvAtomSelection:number[];coverage:{kind:string;indices?:number[];rule?:string};history:string;sourceFiles:Record<string,string>};aiReview?:{status?:string};canConfirm:boolean;scientificValidation:'not_run';}
export interface LocalReviewPreview extends LocalReviewEntry {text:string|null;binary?:boolean;evidence?:string;complete:true;canConfirm:boolean;}
export interface LocalReviewConfirmation {status:'confirmed'|'cancelled';taskId:string;receipt?:{id:string;confirmedAt:number;scientificValidation:'not_run'};aiReview?:{status?:string};}
export interface LocalReviewApi {inspect(value:{taskId:string}):Promise<LocalReviewInspection>;read(value:{taskId:string;snapshotId:string;entryId:string}):Promise<LocalReviewPreview>;confirm(value:{taskId:string;snapshotId:string}):Promise<LocalReviewConfirmation>;}

export interface LocalReviewStatus {taskId:string;parameterRevision:number;provider:string;threadId:string;status:'current'|'stale'|'not_run';authority:{kind:'local-human';id:string;sha256:string}|null;scope:'local';fileCheck:string;targetConfirmationRequired?:boolean;}
