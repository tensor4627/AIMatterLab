/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export type Provider='codex'|'kimi'|'qwen'|'deepseek'|'compatible';

export type ParameterType='number'|'integer'|'number_vector'|'integer_vector'|'number_matrix';

export type ParamValue=number|null|ParamValue[];

export interface ParameterSchema{name:string;type:ParameterType;units:string;description:string;required:boolean;default?:ParamValue;min?:number;max?:number}

export interface FormulaSpec{name:string;formula:string;expression:string;symbols:{name:string;meaning:string;units:string;domain:string}[];units:string;domain:string;pbc:'none'|'row_mic'|'';atom_selection:number[];output_size:number|null;parameters:ParameterSchema[];invariances:('translation'|'rotation'|'periodic_translation')[];singularities:string[];references?:string[]}

export interface Expected{specSha:string|null;codeSha:string|null;parametersSha:string|null;revision:string|null}

export interface Check{name:string;status:'passed'|'failed'|'blocked'|'not_run';detail:string;maxError?:number|null}

export interface NumericalReport{status:'not_run'|'queued'|'running'|'passed'|'failed'|'blocked'|'unknown';specSha:string;codeSha:string;parametersSha:string;environmentId?:string;runtimeReceiptSha?:string;structureAssetId?:string;structureSha?:string;serializedSha?:string;selfConsistency?:{status:'passed'|'failed'|'blocked'|'not_run'};independentReference?:{status:'passed'|'failed'|'blocked'|'not_run';assetId?:string;sha256?:string;reason?:string};referenceKind?:string;referenceSource?:string;targetBiasAndMD?:{status:'passed'|'failed'|'blocked'|'not_run'};checks:Check[];evidence?:{path:string;sha256:string};reason?:string}

export interface LibraryReview{source_files:Record<string,string>;classes:string[];reason:string}

export interface CustomEntry{id:string;taskId:string;name:string;spec:FormulaSpec;parameterValues:Record<string,ParamValue>;expected:Expected;code?:string;formulaApproval?:{specSha:string;confirmedAt:string}|null;codeApproval?:{specSha:string;codeSha:string;confirmedAt:string}|null;numerical?:NumericalReport;sharing:Partial<Record<Provider,boolean>>;gitCommit?:string;attached?:{taskId:string;compositionSha:string};stablePhase?:{status:'not_run'|'proposed'|'completed'|'declined';reportSha?:string}}

export interface LibraryItem{id:string;name:string;specSha:string;codeSha:string|null;numericalStatus:string;owned?:boolean;expected?:Expected|null}

export interface StructureReceipt{id:string;name:string;sha256:string}

export interface RuntimeReceipt{sha256:string|null;environmentId:string;name:string;status:'passed'|'blocked'|'not_run';maxSeconds:number;interpreter?:string;reason?:string}

export interface NumericScope{sha256:string;taskId:string;projectId:string;environmentId:string;entryId:string;revision:string;specSha:string;codeSha:string;parametersSha:string;runtimeReceiptSha:string;structureAssetId:string;structureSha:string;interpreter:string;maxSeconds:number;fdAtomIndices:number[];device:'cpu';referenceKind?:string;referenceSource?:string;referenceAssetId?:string;referenceAssetSha?:string;referenceValues?:number[];referenceMethod?:string}

export interface CustomCvCapabilities{approveFormula:boolean;approveCode:boolean;validate:boolean;attach:boolean;sharing:boolean;reuse?:boolean;parameterTypes:ParameterType[];expressionFunctions:string[]}

export interface CustomCvReadResult{taskId:string;entry:CustomEntry|null;entries:LibraryItem[];runtime:RuntimeReceipt|null;currentStructure:StructureReceipt|null;numericScope?:NumericScope|null;libraryReview?:LibraryReview|null;referenceAssets:{id:string;name:string;sha256:string}[];capabilities:CustomCvCapabilities}

export interface CustomCvRequest{taskId:string;id?:string;expected?:Expected;provider?:Provider;spec?:FormulaSpec;parameterValues?:Record<string,ParamValue>;referenceAssetId?:string;enabled?:boolean}

export type CustomCvMethod='customCv.read'|'customCv.saveSpec'|'customCv.approveFormula'|'customCv.approveCode'|'customCv.sharing'|'customCv.validate'|'customCv.attach'|'customCv.status'|'customCv.reuse';

export type CustomCvInvoke=(method:CustomCvMethod,payload:CustomCvRequest)=>Promise<unknown>;
