import {useRef,useState} from 'react';
import type {AssetOption,CanonicalGraph} from './pygas-composer-types';
export interface CompositionAssetImportResult{taskId:string;cancelled:boolean;asset?:AssetOption;assets?:AssetOption[];receipt?:{kind:'human_native_dialog';sha256:string;size:number}}
export interface CompositionAssetImportContext{taskId:string;ownerKey:string;graph:CanonicalGraph;pairIdentity:string;assets:AssetOption[]}
/** Native dialog, file copying and filesystem authority remain main-owned. */
export function useCompositionAssetImport(p:{readCurrent:()=>CompositionAssetImportContext;invokeImport:(request:{taskId:string})=>Promise<CompositionAssetImportResult>;onImported:(graph:CanonicalGraph,assets:AssetOption[])=>void;onError:(error:unknown)=>void}){
 const [choosing,setChoosing]=useState(false),sequence=useRef(0),inFlight=useRef(false);const latest=useRef(p);latest.current=p;
 async function chooseAsset(nodeId:string,parameter:string){
  if(inFlight.current)return;const before=p.readCurrent(),node=before?.graph?.nodes?.find(n=>n.id===nodeId);if(!node)return;
  const anchor={taskId:before.taskId,ownerKey:before.ownerKey,pairIdentity:before.pairIdentity,nodeKind:node.kind,className:node.class_name,priorValue:JSON.stringify(node.params?.[parameter])},token=++sequence.current;inFlight.current=true;setChoosing(true);
  try{const value=await p.invokeImport({taskId:before.taskId});if(value.cancelled)return;
   if(value.taskId!==anchor.taskId||!value.asset||!value.asset.id||!value.asset.path||!value.asset.name||!value.asset.sha256||!/^[0-9a-f]{64}$/.test(value.asset.sha256)||value.receipt?.kind!=='human_native_dialog'||value.receipt.sha256!==value.asset.sha256||!Number.isSafeInteger(value.receipt.size)||value.receipt.size<0)throw Error('Imported asset receipt is incomplete or mismatched');
   const now=latest.current.readCurrent(),current=now.graph.nodes.find(n=>n.id===nodeId);
   if(token!==sequence.current||now.taskId!==anchor.taskId||now.ownerKey!==anchor.ownerKey||now.pairIdentity!==anchor.pairIdentity||!current||current.kind!==anchor.nodeKind||current.class_name!==anchor.className||JSON.stringify(current.params?.[parameter])!==anchor.priorValue)return;
   const assets=[...now.assets.filter(a=>a.id!==value.asset!.id&&a.path!==value.asset!.path),value.asset],graph={...now.graph,nodes:now.graph.nodes.map(n=>n.id===nodeId?{...n,params:{...n.params,[parameter]:value.asset!.path}}:n)};
   latest.current.onImported(graph,assets);
  }catch(error){if(token===sequence.current)latest.current.onError(error);}finally{if(token===sequence.current){inFlight.current=false;setChoosing(false);}}
 }
 return {choosing,onChooseAsset:chooseAsset,invalidate:()=>{sequence.current++;inFlight.current=false;setChoosing(false);}};
}
