type Span={start:number;end:number};
type JsonNode=Span&(
 {kind:'object';members:{key:string;start:number;value:JsonNode}[]}|
 {kind:'array';items:JsonNode[]}|
 {kind:'scalar'}
);
type JsonPath=readonly (string|number)[];
export type JsonDraft={source:string;value:unknown;root:JsonNode;duplicateKeys:boolean;lossyNumbers:boolean};
export function isJsonObject(value:unknown):value is Record<string,unknown>;
export function inspectJsonDraft(source:string):JsonDraft|null;
export function jsonDraftIssue(document:JsonDraft):'duplicate'|'number'|null;
export function jsonDraftValueSource(document:JsonDraft,path:JsonPath):string|undefined;
export function editJsonDraft(source:string|JsonDraft,path:JsonPath,encoded?:string,options?:{duplicateKeys?:'last'}):string;
