import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {managedToolSkillContext} from './managed-tool-context.mjs';
import {toolValueResult} from '../tools/tool-failure.mjs';

export const SELECTED_MANAGED_FUNCTION='selected.managed';
const OWNERS=['provider','threadId','taskId','projectId','environmentId','inputRoot'];
const fail=()=>{throw Error('Selected managed guidance is unavailable in this current conversation; explicitly select the registered delivery skill again.');};
const documentId=(token,logical)=>token+':'+encodeURIComponent(logical);
const ownerKey=(provider,threadId)=>JSON.stringify([provider,threadId]);
const packageManifest='tool.json';
const MAX_MANIFEST_VIEWS=512;
const fitsMcpBudget=result=>Buffer.byteLength(JSON.stringify(toolValueResult(result)))<=24*1024;

function documentResult(document,attachments,text,documentIds,details={}){
 return {status:'passed',function_id:SELECTED_MANAGED_FUNCTION,document_id:document,document_ids:documentIds,attachments,text,
  bytes:Buffer.byteLength(text),scope:'One exact registered selected-package document; no execution, project authorization or scientific validation.',...details};
}

function manifestDocument(entry,document,context,section={kind:'manifest'}){
 // The managed reader encloses the verified JSON in a header and a final document list.
 const header='[Selected skill document: '+entry.selection.name+'; '+packageManifest+']\n';
 const raw=context.text.slice(header.length,context.text.lastIndexOf('\n\n'));
 const manifest=JSON.parse(raw);
 const {kind,position,chunk}=section;
 const item=kind==='function'?manifest.functions[position]:kind==='test'?manifest.tests.cases[position]:manifest;
 const body=kind==='manifest'?raw:JSON.stringify(item);
 const views=new Map();
 const offer=(logical,target)=>{
  const id=documentId(entry.token,packageManifest+'#'+logical);
  views.set(id,target);
  return id;
 };
 const jsonResult=value=>documentResult(document,context.attachments,JSON.stringify(value),[...views.keys()]);
 if(chunk){
  const result=documentResult(document,context.attachments,body.slice(chunk.start,chunk.end),[],
   {manifest_view:'chunk',chunk_index:chunk.index});
  return {result,views};
 }

 let index;
 if(kind==='manifest'){
  const {id,name,repository,environment,manual,guidance,functions,tests}=manifest;
  // A section ID ending in .md or .json must stay distinct from a real document path.
  const forItem=(kind,id,position)=>offer(kind+'/'+id+(/\.(?:md|json)$/i.test(id)?'/view':''),{kind,position});
  index={manifest_view:'index',id,name,version:entry.record.package_version,repository,environment,manual,guidance,
   functions:functions.map(({id,name,entrypoint,tests},position)=>({id,name,entrypoint,tests,document_id:forItem('function',id,position)})),
   tests:{directory:tests.directory,introduction:tests.introduction,
    cases:tests.cases.map(({id,function_id},position)=>({id,function_id,document_id:forItem('test',id,position)}))}};
  const result=jsonResult(index);
  if(fitsMcpBudget(result))return {result,views};
  // The index itself already advertises these IDs. Avoid duplicating them for larger indexes.
  const compact={...result,document_ids:[]};
  if(fitsMcpBudget(compact))return {result:compact,views};
  views.clear();
 }else{
  const result=documentResult(document,context.attachments,body,[]);
  if(fitsMcpBudget(result))return {result,views};
 }

 const chunks=[];
 const sectionPath=position===undefined?kind:kind+'/'+position;
 // Unicode code points stay intact. Each code point of valid JSON costs at most four bytes
 // when a plain text chunk is serialized through the two enclosing MCP JSON strings.
 for(const match of body.matchAll(/.{1,4096}/gsu)){
  const index=chunks.length,start=match.index,end=start+match[0].length;
  chunks.push({document_id:offer('chunk/'+sectionPath+'/'+index,{...section,chunk:{index,start,end}})});
 }
 if(kind!=='manifest')return {result:jsonResult({manifest_view:'chunks',section:kind,id:item.id,chunks}),views};

 const {id,name,version,repository,environment,manual,guidance,functions,tests}=index;
 const summary={manifest_view:'index',id,name:[...name].slice(0,120).join(''),version,repository,manual,
  environment:{hardware:environment.hardware,parallelism:environment.parallelism},guidance:{delivery:guidance.delivery??'SKILL.md'},
  function_count:functions.length,tests:{directory:tests.directory,introduction:tests.introduction,case_count:tests.cases.length},chunks};
 return {result:jsonResult(summary),views};
}

/** Main-owned, turn-bound disclosure receipts. Callers provide only an advertised opaque ID. */
export class SelectedManagedGuidance{
 constructor(){this.bindings=new Map();}
 clear(provider,threadId){if(threadId!==undefined)this.bindings.delete(ownerKey(provider,threadId));else for(const [id,binding]of this.bindings)if(binding.scope.provider===provider)this.bindings.delete(id);}
 current(scope){
  const binding=this.bindings.get(ownerKey(scope?.provider,scope?.threadId));if(!binding)return null;
  try{
   if(typeof scope.checkCurrent!=='function'||scope.checkCurrent()!==true||typeof binding.scope.checkCurrent!=='function'||binding.scope.checkCurrent()!==true||OWNERS.some(key=>(scope[key]??null)!==(binding.scope[key]??null)))return null;
   for(const entry of binding.entries.values()){entry.assertCurrent();if(!isDeepStrictEqual(entry.record,entry.currentRecord()))return null;}
   return binding;
  }catch{return null;}
 }
 advertise(entry,documents){
  if(!Array.isArray(documents)||documents.length>128)throw Error('Selected managed document metadata exceeds its bounded limit');
  for(const logical of documents){if(typeof logical!=='string'||!/\.(md|json)$/i.test(logical)||!entry.record.files.some(row=>row.path===logical))throw Error('Unregistered selected managed document');entry.documents.set(documentId(entry.token,logical),logical);}
 }
 decorate(context,entry){
  const ids=[...entry.documents].filter(([,target])=>typeof target==='string').map(([id])=>id);
  const text=context.text+'\n\nRead another supporting document only when needed using read_scientific_skill with function_id "'+SELECTED_MANAGED_FUNCTION+'" and an exact document_id from: '+JSON.stringify(ids)+'. These identifiers belong only to this explicitly selected package version and this conversation turn.';
  return {...context,document_ids:ids,text,totalBytes:Buffer.byteLength(text)};
 }
 definitionVisible(entry){
  return entry.record.immutable===true&&entry.record.manifest&&entry.record.files.some(row=>row.path===packageManifest&&row.kind==='file')&&
    entry.policy.allowsPath(path.join(entry.record.snapshot_root,packageManifest));
 }
 bind({selection,record,context,policy,scope,assertCurrent,currentRecord}){
  if(!scope?.provider||!scope.threadId||typeof scope.checkCurrent!=='function'||typeof assertCurrent!=='function'||typeof currentRecord!=='function'||!policy||typeof policy.revalidate!=='function')fail();
  assertCurrent();if(scope.checkCurrent()!==true)fail();
  let binding=this.current(scope);
  if(!binding)binding={scope,entries:new Map()};
  const entry={selection:structuredClone(selection),record:structuredClone(record),policy,scope,assertCurrent,currentRecord,token:randomUUID(),documents:new Map()};
  if(!isDeepStrictEqual(entry.record,currentRecord()))fail();this.advertise(entry,context.document_ids||['SKILL.md']);
  if(this.definitionVisible(entry))entry.documents.set(documentId(entry.token,packageManifest),packageManifest);
  const disclosed=this.decorate(context,entry);
  if(disclosed.totalBytes>512*1024)throw Error('Selected managed entry exceeds its bounded context limit');
  binding.entries.set(entry.token,entry);this.bindings.set(ownerKey(scope.provider,scope.threadId),binding);
  return disclosed;
 }
 catalog(scope,policy){
  const binding=this.current(scope);if(!binding)return null;
  if(policy&&[...binding.entries.values()].some(entry=>!isDeepStrictEqual(entry.policy.facts,policy.facts)))return null;
  const entries=[...binding.entries.values()];
  const definitions=entries.filter(entry=>this.definitionVisible(entry)).map(({token,record})=>({
   package_ref:token,package_id:record.package_id,package_version:record.package_version,
   document_id:documentId(token,packageManifest)
  }));
  return {id:SELECTED_MANAGED_FUNCTION,title:'Selected registered package guidance',phase:'selected-delivery',engines:[],tools:['read_scientific_skill'],status:'guidance-only',sources:['selected-package'],permission:'allowed',source_status:'registered',document_ids:entries.flatMap(entry=>[...entry.documents.keys()]),...definitions.length?{definitions}:{},scope:'Supporting documents for delivery skills explicitly selected in this current conversation turn only.'};
 }
 async resolveDefinition(packageRef,scope){
  const binding=this.current(scope);
  const entry=binding?.entries.get(packageRef);
  const check=()=>{if(!entry||this.current(scope)!==binding||!this.definitionVisible(entry))fail();};
  check();await entry.policy.revalidate();check();
  return {record:structuredClone(entry.record),check};
 }
 async read(document,scope){
  const binding=this.current(scope);if(!binding||typeof document!=='string')fail();
  const entry=[...binding.entries.values()].find(value=>value.documents.has(document));if(!entry)throw Error('Choose an exact document_id advertised for the selected managed skill');
  const fresh=()=>{if(this.current(scope)!==binding||!isDeepStrictEqual(entry.record,entry.currentRecord()))fail();entry.assertCurrent();};
  const target=entry.documents.get(document),virtual=typeof target!=='string';
  const logical=virtual?packageManifest:target;
  fresh();await entry.policy.revalidate();fresh();
  const context=await managedToolSkillContext({selection:entry.selection,record:entry.record,policy:entry.policy,scope:entry.scope,documentId:logical});
  fresh();await entry.policy.revalidate();fresh();const staged={...entry,documents:new Map(entry.documents)};this.advertise(staged,context.document_ids);
  let result,views;
  if(!virtual){
   const disclosed=this.decorate(context,staged);
   result=documentResult(document,disclosed.attachments,disclosed.text,disclosed.document_ids);
  }
  if(virtual||logical===packageManifest&&!fitsMcpBudget(result)){
   ({result,views}=manifestDocument(entry,document,context,virtual?target:undefined));
  }
  if(!fitsMcpBudget(result))throw Error('Selected managed document exceeds the serialized MCP 24 KiB budget; its body was not delivered.');
  if(views?.size){
   for(const [id,view] of views)staged.documents.set(id,view);
   if([...staged.documents.values()].filter(target=>typeof target!=='string').length>MAX_MANIFEST_VIEWS)throw Error('Selected managed manifest metadata exceeds its bounded limit');
  }
  fresh();entry.documents=staged.documents;return result;
 }
}
