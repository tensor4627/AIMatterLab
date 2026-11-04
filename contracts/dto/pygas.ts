/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

import type {AssetOption} from './assets';
export type {AssetOption} from './assets';

export type DataValue=number|boolean|string|null|DataValue[];

export type LibraryKind='cv'|'bias'|'switch'|'neighbor';

export type FrameworkNodeKind='input'|'collect'|'output'|'reduce';

export interface EmbeddedEditorHint{editor:string;shape?:(number|null)[];options?:(string|null)[];serializer?:string;tensor_dtype?:string;basic?:boolean;units?:string;provenance:{kind:string;sha256:string;source:string}}

export interface ParamDefinition{editor_hint?:EmbeddedEditorHint;name:string;default:string;required:boolean;annotation:string;is_module_param:boolean;type_hint:string;default_is_literal:boolean;default_value:unknown}

export interface SourceLocation{name:string;line:number;sha256:string}

export interface CatalogEntry{kind:LibraryKind;name:string;params:ParamDefinition[];forward_args:string[];from_dict_sections:string[];requires_switch:boolean;supports_pipeline:boolean;unknown_forward_args:string[];documentation:string;source:SourceLocation;validation:string;output_size?:number|null;semantics?:{source:string;sha256:string;reorder_policy?:string;ordered_cv_parameters?:Record<string,{axis:number}>;graph_support?:string;reason?:string;[key:string]:unknown}}

export interface SourceReceipt{id?:string;commit?:string;dirty?:boolean;files:Record<string,string>}

export interface SettingsField{key:string;location:string;group:string;type:string;required?:boolean;read_only:boolean;origin:{path:string;sha256:string;lines:number[]};editor_hint:{editor?:string;options?:(string|number|boolean|null)[];shape?:(number|null)[];minimum?:number;exclusive_minimum?:number};applicable?:string;renderer_fallback?:unknown;gui_initial?:unknown;source_default?:unknown;proposal?:string;condition?:string;units?:string;unit?:string|null;[key:string]:unknown}

export interface SettingsSchema{status:string;source_files:Record<string,string>;fields:SettingsField[];scope?:string}

export interface CatalogResponse{settings_schema?:SettingsSchema;ports?:{status:string;source_sha256?:string;classes?:Record<string,Ports>;runtime_ports?:Record<string,string>;templates?:Record<string,Record<string,Ports>>;multiple_inputs?:[string,string][];compatible_pairs?:[string,string][];reductions?:string[];reason?:string};schema_version:1;status:string;scope:string;source:SourceReceipt;catalog:Record<LibraryKind,CatalogEntry[]>;validation:string}

export interface GraphNode{id:string;kind:string;class_name?:string;params?:Record<string,unknown>;output_size?:number;[name:string]:unknown}

export interface GraphEndpoint{node:string;port:string}

export interface GraphEdge{source:GraphEndpoint;target:GraphEndpoint;[name:string]:unknown}

export interface CanonicalGraph{version:number;mode?:string;settings:Record<string,unknown>;nodes:GraphNode[];edges:GraphEdge[];[name:string]:unknown}

export interface Ports{inputs:Record<string,string>;outputs:Record<string,string>;configurationInputs?:string[];multipleInputs?:string[]}

export interface GraphContract{source:SourceLocation;catalog_files:Record<string,string>;ports:Record<string,Ports>;reductions:{id:string;description:string}[];compatible_pairs:[string,string][]}

export interface ParameterEditor{type:'number'|'integer'|'boolean'|'array'|'enum'|'asset';options?:{label:string;value:string|number|boolean|null}[];itemType?:'number'|'integer'|'boolean';shape?:(number|null)[];label?:string;unit?:string;scientific?:boolean;source_sha256:string;basis:string}

export type EditorMetadata=Record<string,Record<string,ParameterEditor>>;

export interface DerivedStructure{values:{n_atoms?:number;numbers?:number[];atomic_types?:number[]};provenance:string|{source?:string;path?:string;sha256?:string;frame?:number}|null;sha256?:string|null}

export interface OrderingReview{status:'permuted'|'blocked'|'unchanged';collectorId:string;renderBlocked:boolean;requiresRevalidation:boolean;reasons:string[];warnings:string[];permutation?:number[];before?:{node:string;port:string;size:number;basis:string}[];after?:{node:string;port:string;size:number;basis:string}[];affectedParameters?:{nodeId:string;name:string;sourceSHA256:string;before:unknown;after:unknown}[];invalidated?:('numerical'|'prepared'|'artifact'|'history')[]}

export interface ReorderResult extends OrderingReview{graph:CanonicalGraph}

export interface SaveIntent{orderingReview?:OrderingReview;expected_sha256:string|null;catalog_files:Record<string,string>;missing_fields:string[];stage:'draft'}

export type CustomCVEntryRequest={stage:'formula_discussion';implemented:false;source_files:Record<string,string>}|{stage:'private_workbench';source_files:Record<string,string>};

export interface PygasExpectedInputs {journal_sha256:string|null;files:Record<string,string|null>}

export interface PygasComposition {id:string;graphPath:string;sourcePath:string;status:'rendered'|'draft'|'blocked';expected:PygasExpectedInputs;graph_sha256:string|null;source_sha256:string|null;missing_fields?:string[];render_blocked?:boolean;reasons?:string[]}

export interface PygasTaskReadRequest {taskId:string;path?:string}

export interface PygasTaskInitializeRequest {taskId:string;expected:{journal_sha256:null;files:Record<string,never>};catalog_files:Record<string,string>}

export interface PygasTaskResult {taskId:string;composition:PygasComposition|null;catalog:CatalogResponse;graph:CanonicalGraph|null;derived?:DerivedStructure;assets:AssetOption[];missing_fields?:string[];render_blocked?:boolean;reasons?:string[]}

export interface PygasTaskSaveRequest {taskId:string;path:string;expected:PygasExpectedInputs;catalog_files:Record<string,string>;graph:CanonicalGraph}

export interface PygasTaskNormalizeRequest {taskId:string;path:string;expected:PygasExpectedInputs;catalog_files:Record<string,string>}
