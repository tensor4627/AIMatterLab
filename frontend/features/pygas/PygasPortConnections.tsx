import Button from '../../ui/Button';
import {t} from '../../ui/i18n';
import Disclosure from '../../ui/Disclosure';
import {useRef,useState,type PointerEvent} from 'react';
import type {CanonicalGraph,CatalogResponse,GraphContract,GraphEdge,GraphEndpoint,GraphNode,Ports} from './pygas-composer-types';
import {appendInput,compatibleSources,connectInput,cvOutputRank,entryFor,removeInputEdge} from './pygas-composer-state';

type Props={graph:CanonicalGraph;node:GraphNode;ports:Ports;catalog:CatalogResponse;contract:GraphContract;disabled:boolean;language:'zh-CN'|'en';onChange:(next:CanonicalGraph,port:string)=>void;onReorder:(edge:GraphEdge,delta:number)=>void};
const sameEndpoint=(a:GraphEndpoint,b:GraphEndpoint)=>a.node===b.node&&a.port===b.port;
const label=(endpoint:GraphEndpoint)=>endpoint.node+'.'+endpoint.port;
const endpointKey=(endpoint:GraphEndpoint)=>JSON.stringify([endpoint.node,endpoint.port]);

export default function PygasPortConnections({graph,node,ports,catalog,contract,disabled,language,onChange,onReorder}:Props){
 const drag=useRef<{graph:CanonicalGraph;edge:GraphEdge;pointerId:number}|null>(null);
 const [dropTarget,setDropTarget]=useState<GraphEdge|null>(null);
 const [sourcePicker,setSourcePicker]=useState('');
 const locale={language};
 const nodes=new Map(graph.nodes.map(source=>[source.id,source]));
 function sourceDimension(endpoint:GraphEndpoint):{rank?:number;size?:number}{
  const source=nodes.get(endpoint.node);
  if(!source||endpoint.port!=='value')return {};
  if(source.kind==='cv'){
   const entry=entryFor(catalog,source),size=entry?.output_size;
   return {rank:cvOutputRank(entry),size:typeof size==='number'&&Number.isSafeInteger(size)&&size>0?size:undefined};
  }
  // The declared reshape and reductions yield one axis once an input is connected.
  if(source.kind==='reduce'&&['identity','mean','sum','first'].includes(String(source.params?.operation))&&
   contract.reductions.some(item=>item.id===source.params?.operation)&&
   graph.edges.filter(edge=>edge.target.node===source.id&&edge.target.port==='value').length===1)return {rank:1};
  return {};
 }
 function preview(source:GraphEndpoint,port:string,compatible=true,index?:number){
  const {rank,size}=sourceDimension(source),type=ports.inputs[port];
  const dimension=rank!==undefined?rank+'D':type==='value'||type==='cv'?t("阶数待确认", locale):'';
  const conflict=!compatible?t("原连接与当前端口契约不匹配", locale):
   rank===0&&node.kind!=='reduce'?t("0D 输出需先连接 Reduce", locale):'';
  return <span className="pg-port-preview" data-conflict={conflict?true:undefined}>
   <span className="pg-port-path">{index!==undefined&&<span className="pg-port-order">{index+1}</span>}<code>{label(source)}</code>
    {dimension&&<span className="pg-port-dimension">{dimension}{size!==undefined&&rank!==0&&` · ${size} ${t("分量", locale)}`}</span>}<span className="pg-port-arrow" aria-hidden="true">→</span><code>{node.id}.{port}</code>
   </span>{conflict&&<small>{conflict}</small>}
  </span>;
 }
 function stopDrag(){drag.current=null;setDropTarget(null);}
 return <Disclosure className="pg-connections" summary={<>{t("实际端口与连接", locale)}</>}>
  {Object.entries(ports.inputs).map(([port,type])=>{
   const edges=graph.edges.filter(edge=>edge.target.node===node.id&&edge.target.port===port);
   const multiple=ports.multipleInputs?.includes(port),ordered=multiple&&node.kind==='collect'&&port==='value';
   const allowed=compatibleSources(graph,node,port,contract,catalog);
   const newSources=allowed.filter(source=>!edges.some(edge=>sameEndpoint(source,edge.source)));
   const connect=(source:GraphEndpoint|null)=>{
    if(disabled)return;
    if(source){if(!allowed.some(candidate=>sameEndpoint(candidate,source)))return;
     onChange(multiple?appendInput(graph,node.id,port,source):connectInput(graph,node.id,port,source),port);
    }else if(!multiple)onChange(connectInput(graph,node.id,port,null),port);
   };
   const dropIndex=(event:PointerEvent<HTMLSpanElement>)=>{
    const active=drag.current;
    if(disabled||active?.graph!==graph||active.pointerId!==event.pointerId)return -1;
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-cv-index]');
    if(!row||row.parentElement!==event.currentTarget.closest('.pg-port'))return -1;
    return Number(row.dataset.cvIndex);
   };
   return <div key={port} className="pg-port" data-param={node.id+'.'+port}>
    <strong>{port}</strong><small>{type}</small>
    {edges.map((edge,index)=><div className="pg-edge" key={endpointKey(edge.source)} data-testid="pygas-port-edge" data-cv-index={ordered?index:undefined} data-drag-over={dropTarget===edge?true:undefined}>
     {ordered&&edges.length>1&&<span className="pg-edge-grip" data-testid="pygas-cv-drag-handle" aria-hidden="true" data-disabled={disabled?true:undefined} title={t("拖动调整 CV 顺序", locale)}
      onPointerDown={event=>{
       if(disabled||!event.isPrimary||event.button!==0)return;
       event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={graph,edge,pointerId:event.pointerId};
      }}
      onPointerMove={event=>{
       if(drag.current?.pointerId!==event.pointerId)return;
       const target=dropIndex(event);setDropTarget(target!==index?edges[target]||null:null);
      }}
      onPointerUp={event=>{
       if(drag.current?.pointerId!==event.pointerId)return;
       const from=edges.indexOf(drag.current.edge),target=dropIndex(event);stopDrag();
       if(from>=0&&target!==from&&edges[target])onReorder(edge,target-from);
      }}
      onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>⠿</span>}
     {preview(edge.source,port,allowed.some(source=>sameEndpoint(source,edge.source)),multiple?index:undefined)}
     <div className="pg-edge-actions">
      <Button variant="icon" size="sm" type="button" disabled={disabled} disabledReason={t('当前暂不可编辑', locale)} aria-label={'Remove connection '+node.id+' '+port+' '+index} onClick={()=>onChange(removeInputEdge(graph,edge),port)}>×</Button>
      {multiple&&<>
      <Button variant="icon" size="sm" type="button" disabled={disabled||index===0} disabledReason={t(disabled?'当前暂不可编辑':'已在首位', locale)} aria-label={'Move up '+node.id+' '+index} onClick={()=>onReorder(edge,-1)}>↑</Button>
      <Button variant="icon" size="sm" type="button" disabled={disabled||index===edges.length-1} disabledReason={t(disabled?'当前暂不可编辑':'已在末位', locale)} aria-label={'Move down '+node.id+' '+index} onClick={()=>onReorder(edge,1)}>↓</Button>
      </>}
     </div>
    </div>)}
    <select aria-label={node.id+'.'+port+(multiple?' add connection':' connection')} value={!multiple&&edges[0]?JSON.stringify(edges[0].source):''} disabled={disabled}
     onChange={event=>connect(event.target.value?JSON.parse(event.target.value):null)}>
     <option value="">{multiple?t("添加已声明的来源连接", locale):'—'}</option>
     {(multiple?newSources:allowed).map(source=><option key={endpointKey(source)} value={JSON.stringify(source)}>{label(source)}</option>)}
    </select>
    {!!newSources.length&&<Disclosure className="pg-source-choices" open={sourcePicker===port} onToggle={event=>{const open=event.currentTarget.open;setSourcePicker(previous=>open?port:previous===port?'':previous);}} summary={<>{t("可视化选接", locale)}</>}>
     {sourcePicker===port&&<div className="pg-source-buttons">{newSources.map(source=><button type="button" key={endpointKey(source)} disabled={disabled}
      onClick={event=>{connect(source);event.currentTarget.closest('.pg-port')?.querySelector('select')?.focus();}}>{preview(source,port)}</button>)}</div>}
    </Disclosure>}
   </div>;
  })}
  {Object.entries(ports.outputs).map(([port,type])=><div key={port} className="pg-port"><strong>{port}</strong><small>{t("输出", locale)} · {type}</small></div>)}
 </Disclosure>;
}
