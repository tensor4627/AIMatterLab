import {inspectJsonDraft,isJsonObject,jsonDraftIssue} from '../../ui/json-draft.mjs';

export const environmentSections=['executables','repositories','variables'] as const;
export type EnvironmentSection=typeof environmentSections[number];

type EnvironmentObject=Record<string,unknown>;
type RawIssue='syntax'|'object'|'duplicate'|'number';
type Cell={kind:'text';text:string}|{kind:'integer';text:string}|{kind:'json';value:unknown};
type Row={id:number;name:string;originalName?:string;value:Cell};
export type EnvironmentRows=Record<EnvironmentSection,Row[]>;
type RowIssue={section:EnvironmentSection;id:number;field:'name'|'value';code:'name'|'duplicate'|'integer'};
export type ClusterEnvironmentDraft={
 text:string;
 document:EnvironmentObject;
 rows:EnvironmentRows;
 nextId:number;
 rawIssue:RawIssue|null;
 rowIssue:RowIssue|null;
};
export type EnvironmentRowEdit={type:'add'}|{type:'remove';id:number}|{type:'name'|'value';id:number;text:string};

function editorValue(section:EnvironmentSection,value:unknown):Cell {
 if(typeof value==='string')return {kind:'text',text:value};
 if(section==='variables'&&typeof value==='number'&&Number.isSafeInteger(value))return {kind:'integer',text:String(value)};
 return {kind:'json',value};
}

function fromDocument(text:string,document:EnvironmentObject):ClusterEnvironmentDraft {
 const rows:EnvironmentRows={executables:[],repositories:[],variables:[]};
 let nextId=0;
 for(const section of environmentSections){
  const entries=document[section];
  if(isJsonObject(entries))rows[section]=Object.entries(entries).map(([name,value])=>({id:++nextId,name,originalName:name,value:editorValue(section,value)}));
 }
 return {text,document,rows,nextId,rawIssue:null,rowIssue:null};
}

export function readEnvironmentText(draft:ClusterEnvironmentDraft,text:string):ClusterEnvironmentDraft {
 if(draft.rowIssue)return draft;
 const inspected=inspectJsonDraft(text);
 if(!inspected)return {...draft,text,rawIssue:'syntax'};
 if(!isJsonObject(inspected.value))return {...draft,text,rawIssue:'object'};
 const issue=jsonDraftIssue(inspected);
 return issue?{...draft,text,rawIssue:issue}:fromDocument(text,inspected.value);
}

export function makeEnvironmentDraft(value:unknown):ClusterEnvironmentDraft {
 return readEnvironmentText(fromDocument('{}',{}),JSON.stringify(value,null,2)??'{}');
}

export function editableEnvironmentSection(draft:ClusterEnvironmentDraft,section:EnvironmentSection){
 return !Object.hasOwn(draft.document,section)||isJsonObject(draft.document[section]);
}

export function writableEnvironment(draft:ClusterEnvironmentDraft){
 return draft.rawIssue||draft.rowIssue?null:draft.document;
}

function serializeRows(draft:ClusterEnvironmentDraft){
 const document={...draft.document};
 for(const section of environmentSections){
  if(!editableEnvironmentSection(draft,section))continue;
  const entries=new Map<string,unknown>();
  for(const {id,name,originalName,value} of draft.rows[section]){
   if(name===''&&originalName!==''){
    // A newly added empty row has no data to apply yet.
    if(originalName===undefined&&value.kind==='text'&&value.text==='')continue;
    return {...draft,rowIssue:{section,id,field:'name',code:'name'} satisfies RowIssue};
   }
   if(entries.has(name))return {...draft,rowIssue:{section,id,field:'name',code:'duplicate'} satisfies RowIssue};
   if(value.kind==='integer'){
    const parsed=Number(value.text);
    if(!/^-?\d+$/.test(value.text)||!Number.isSafeInteger(parsed)||Object.is(parsed,-0))return {...draft,rowIssue:{section,id,field:'value',code:'integer'} satisfies RowIssue};
    entries.set(name,parsed);
   }else entries.set(name,value.kind==='text'?value.text:value.value);
  }
  if(entries.size||Object.hasOwn(document,section))document[section]=Object.fromEntries(entries);
 }
 const different=JSON.stringify(draft.document)!==JSON.stringify(document);
 return {...draft,document,text:different?JSON.stringify(document,null,2):draft.text,rowIssue:null};
}

export function editEnvironmentRow(draft:ClusterEnvironmentDraft,section:EnvironmentSection,edit:EnvironmentRowEdit):ClusterEnvironmentDraft {
 if(draft.rawIssue||!editableEnvironmentSection(draft,section))return draft;
 let nextId=draft.nextId;
 const before=draft.rows[section];
 const rows=edit.type==='add'?[...before,{id:++nextId,name:'',value:{kind:'text',text:''} as const}]
  :edit.type==='remove'?before.filter(row=>row.id!==edit.id)
  :before.map(row=>{
   if(row.id!==edit.id)return row;
   if(edit.type==='name')return {...row,name:edit.text};
   return row.value.kind==='json'?row:{...row,value:{...row.value,text:edit.text}};
  });
 return serializeRows({...draft,rows:{...draft.rows,[section]:rows},nextId});
}
