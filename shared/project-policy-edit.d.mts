export interface EditableProjectSpec {name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}}
export interface ProjectPolicyEditor {open():Promise<{id:string;spec:EditableProjectSpec}>;cancel():void;save(spec:EditableProjectSpec):Promise<any>}
export function editableProjectSpec(record:any):EditableProjectSpec;
export function validateProjectSpec(spec:any,engines:string[]):void;
export function projectPolicyChanges(before:EditableProjectSpec,after:EditableProjectSpec):{key:string;before:any;after:any}[];
export function createProjectPolicyEditor(options:{projectId:string;read:()=>Promise<any>;write:(record:any)=>Promise<any>;current:()=>boolean;engines:string[]}):ProjectPolicyEditor;

