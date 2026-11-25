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
  for(const logical of documents){if(typeof logical!=='string'||!entry.record.files.some(row=>row.path===logical))throw Error('Unregistered selected managed document');entry.documents.set(documentId(entry.token,logical),logical);}
 }
 decorate(context,entry){
  const ids=[...entry.documents.keys()],text=context.text+'\n\nRead another supporting document only when needed using read_scientific_skill with function_id "'+SELECTED_MANAGED_FUNCTION+'" and an exact document_id from: '+JSON.stringify(ids)+'. These identifiers belong only to this explicitly selected package version and this conversation turn.';
  if(Buffer.byteLength(text)>512*1024)throw Error('Selected managed entry exceeds its bounded context limit');return {...context,document_ids:ids,text,totalBytes:Buffer.byteLength(text)};
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
  const disclosed=this.decorate(context,entry);binding.entries.set(entry.token,entry);this.bindings.set(ownerKey(scope.provider,scope.threadId),binding);
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
  fresh();await entry.policy.revalidate();fresh();
  const context=await managedToolSkillContext({selection:entry.selection,record:entry.record,policy:entry.policy,scope:entry.scope,documentId:entry.documents.get(document)});
  fresh();await entry.policy.revalidate();fresh();const staged={...entry,documents:new Map(entry.documents)};this.advertise(staged,context.document_ids);
  const disclosed=this.decorate(context,staged),result={status:'passed',function_id:SELECTED_MANAGED_FUNCTION,document_id:document,document_ids:disclosed.document_ids,attachments:disclosed.attachments,text:disclosed.text,bytes:Buffer.byteLength(disclosed.text),scope:'One exact registered selected-package document; no execution, project authorization or scientific validation.'};
  if(Buffer.byteLength(JSON.stringify(toolValueResult(result)))>24*1024)throw Error('Selected managed document exceeds the serialized MCP 24 KiB budget; its body was not delivered.');
  fresh();entry.documents=staged.documents;return result;
 }
}
