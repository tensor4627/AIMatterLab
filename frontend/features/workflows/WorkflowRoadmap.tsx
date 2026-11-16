import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,Maximize,Minus,Plus,X} from 'lucide-react';
import type {WorkflowRoadmap as Roadmap} from '../../../contracts/workflows/roadmap.mjs';
import {t} from '../../ui/i18n';
import type {ToolGroupRecord} from '../../../contracts/dto/tools';
import {layoutFrozenGroup,layoutRoadmap,legacyRoadmap,portY,type GraphNode,type RoadmapDrawing} from './roadmap-layout';
import './workflow-roadmap.css';

const shorten=(value:string,budget:number)=>{
 let width=0;
 for(const [i,char] of Array.from(value).entries()){
  width+=char.codePointAt(0)!>255?1.8:1;
  if(width>budget)return Array.from(value).slice(0,i).join('')+'…';
 }
 return value;
};
function Graphic({graph,mini=false,selected,onSelect}:{graph:RoadmapDrawing;mini?:boolean;selected?:string;onSelect?:(key:string)=>void}){
 const arrow='roadmap-arrow-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
 return <>
  <defs><marker id={arrow} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6Z" className="roadmap-arrow"/></marker></defs>
  {graph.edges.map((edge,index)=><path key={index} d={edge.path} className={'roadmap-edge'+(selected===edge.from||selected===edge.to?' highlighted':'')} markerEnd={'url(#'+arrow+')'}><title>{graph.labels.get(edge.resource)}</title></path>)}
  {graph.nodes.map(node=>{
   const step=node.kind==='step',w=node.width,h=node.height;
   function runtime(side:'top'|'bottom'){
    const name=node.runtime?.[side];if(!name)return null;
    const y=side==='top'?0:h,sign=side==='top'?-1:1,center=y+sign*25;
    return <g className="roadmap-runtime" data-side={side}><path d={'M '+w/2+' '+y+' v '+sign*15}/><circle cx={w/2} cy={y} r={2.5}/>
     <rect x={12} y={center-10} width={w-24} height={20} rx={9}/><text x={w/2} y={center+4} textAnchor="middle">{shorten(name,32)}</text><title>{t('同次执行内调用')} · {name}</title></g>;
   }
   return <g key={node.key} transform={'translate('+node.x+' '+node.y+')'} data-node-key={node.key}
    className={'roadmap-node '+node.kind+(selected===node.key?' selected':'')}
    tabIndex={mini?undefined:0} role={mini?undefined:'button'} aria-label={mini?undefined:node.label+' · '+node.subtitle}
    onKeyDown={mini?undefined:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSelect?.(node.key);}}}>
    <title>{[node.label,node.subtitle,...node.notes].join(' · ')}</title>
    {runtime('top')}{runtime('bottom')}
    <rect className="roadmap-box" width={w} height={h} rx={step?7:12}/>
    <text className="node-meta" x={12} y={18}>{shorten(node.subtitle,step?36:23)}</text>
    <text className="node-label" x={12} y={39}>{shorten(node.label,step?28:17)}</text>
    {step&&<><path className="port-divider" d={'M 0 46 H '+w}/>
     {(['inputs','outputs'] as const).map(side=>node[side].map((port,index)=>{
      const left=side==='inputs',y=portY(index),label=graph.labels.get(port.resource)||port.resource;
      return <g key={side+port.port} className={'roadmap-port '+side}><title>{port.port} · {label} {graph.formats.get(port.resource)}</title>
       <circle cx={left?0:w} cy={y} r={3.5}/><text x={left?10:w-10} y={y+4} textAnchor={left?'start':'end'}>{shorten(label,16)}</text></g>;
     }))}</>}
   </g>;
  })}
 </>;
}

type Camera={factor:number;x:number;y:number};
const home:Camera={factor:1,x:0,y:0};
function RoadmapCanvas({graph,bar,collapse,fields,onField,onDiscuss}:{graph:RoadmapDrawing;bar:ReactNode;collapse:ReactNode;fields:string[];onField:(field:string)=>void;onDiscuss:(text:string)=>void}){
 const svg=useRef<SVGSVGElement>(null),[size,setSize]=useState({width:640,height:164});
 const [camera,setCamera]=useState<Camera>(home),[active,setActive]=useState(false),[selection,select]=useState('');
 const drag=useRef<{id:number;x:number;y:number;moved:boolean;key:string;camera:Camera}|null>(null);
 useLayoutEffect(()=>{
  const element=svg.current;if(!element)return;
  const update=()=>{const {width,height}=element.getBoundingClientRect();if(width>0&&height>0)setSize(old=>old.width===width&&old.height===height?old:{width,height});};
  update();const observer=new ResizeObserver(update);observer.observe(element);return ()=>observer.disconnect();
 },[]);
 const fit=Math.min((size.width-12)/graph.width,(size.height-10)/graph.height,1.4);
 const zoom=(atX:number,atY:number,multiplier:number)=>{
  setCamera(old=>{
   const factor=Math.min(Math.max(4,3/fit),Math.max(0.5,old.factor*multiplier)),ratio=factor/old.factor;
   return {factor,x:atX-(atX-old.x)*ratio,y:atY-(atY-old.y)*ratio};
  });
 };
 useEffect(()=>{
  const element=svg.current;if(!element||!active)return;
  const wheel=(e:WheelEvent)=>{
   e.preventDefault();const rect=element.getBoundingClientRect();
   const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?rect.height:1);
   zoom(e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2,Math.exp(-Math.max(-360,Math.min(360,delta))*0.0025));
  };
  element.addEventListener('wheel',wheel,{passive:false});return ()=>element.removeEventListener('wheel',wheel);
 },[active,fit]);
 const scale=fit*camera.factor;
 const transform='translate('+(size.width/2+camera.x)+' '+(size.height/2+camera.y)+') scale('+scale+') translate('+(-graph.width/2)+' '+(-graph.height/2)+')';
 const selected=graph.nodes.find(node=>node.key===selection);
 const dismiss=()=>{select('');setActive(false);svg.current?.blur();};
 function details(node:GraphNode){
  const resource=(id:string)=>[graph.labels.get(id),graph.formats.get(id),...(graph.requirements.get(id)||[])].filter(Boolean).join(' · ');
  const ports=[...node.inputs.map(port=>resource(port.resource)+' → '+port.port),...node.outputs.map(port=>port.port+' → '+resource(port.resource))];
  const runtime=[node.runtime?.top,node.runtime?.bottom].filter(Boolean);
  return [...new Set([node.subtitle,...node.notes,...ports,...(runtime.length?[t('同次执行内调用')+' · '+runtime.join(' / ')]:[])])].join(' · ');
 }
 const canLocate=selected?.field&&(fields.includes(selected.field)||/^files\.\d+$/.test(selected.field)&&fields.includes('files'));
 return <><div className="roadmap-bar">{bar}<div className="roadmap-view-tools">
   {([[Minus,'缩小流程图',()=>zoom(0,0,0.78)],[Plus,'放大流程图',()=>zoom(0,0,1.28)],[Maximize,'适应全图',()=>setCamera(home)]] as const).map(([Icon,label,click])=>
    <button type="button" key={label} aria-label={t(label)} title={t(label)} onClick={click}><Icon size={14}/></button>)}
  </div>{collapse}</div><div className="roadmap-surface">
  <svg ref={svg} className={'roadmap-canvas'+(active?' active':'')} tabIndex={0} role="group" aria-label={t('计算流程图，点击后可拖动和滚轮缩放')}
   onFocus={()=>setActive(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setActive(false);}}
   onPointerDown={e=>{if(e.button!==0||drag.current)return;e.currentTarget.focus({preventScroll:true});setActive(true);
    drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,key:(e.target as Element).closest('[data-node-key]')?.getAttribute('data-node-key')||'',camera};
    e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{const start=drag.current;if(!start||start.id!==e.pointerId)return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!start.moved&&Math.hypot(dx,dy)<4)return;start.moved=true;
    setCamera({...start.camera,x:start.camera.x+dx,y:start.camera.y+dy});}}
   onPointerUp={e=>{const start=drag.current;if(!start||start.id!==e.pointerId)return;drag.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(!start.moved)select(start.key===selection?'':start.key);}}
   onLostPointerCapture={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
   onKeyDown={e=>{
    const moves:Record<string,[number,number]>={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};
    if(e.key in moves){e.preventDefault();const [x,y]=moves[e.key];setCamera(old=>({...old,x:old.x+x,y:old.y+y}));}
    else if(['+','=','-','Home','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape')dismiss();else if(e.key==='Home')setCamera(home);else zoom(0,0,e.key==='-'?0.78:1.28);}
   }}>
   <g data-testid="roadmap-transform" transform={transform}><Graphic graph={graph} selected={selection} onSelect={select}/></g>
  </svg>
  {selected&&<aside className="roadmap-node-detail" aria-label={t('节点详情')}><div><strong>{selected.label}</strong><span>{details(selected)}</span></div>
   {canLocate&&<button type="button" className="button" onClick={()=>onField(selected.field!)}>{t('定位参数')}</button>}
   {selected.confirm&&<button type="button" className="button" onClick={()=>onDiscuss([t(selected.kind==='output'?'我确认把以下产物列入当前计算流程的交付目标':'我确认当前计算流程需要以下初始输入'),selected.label+' ('+selected.key+')',...(selected.requirements||[])].join(' · '))}>{t('在对话中确认')}</button>}
   <button type="button" className="roadmap-icon" aria-label={t('关闭节点详情')} onClick={()=>select('')}><X size={14}/></button></aside>}
 </div></>;
}

export default function WorkflowRoadmap({taskId,name,roadmap,parameters,group,fields,onField,onPlan,onDiscuss}:{taskId:string;name:string;roadmap?:Roadmap;parameters:Record<string,unknown>;group?:ToolGroupRecord;fields:string[];onField:(field:string)=>void;onPlan:()=>void;onDiscuss:(text:string)=>void}){
 const [collapsed,setCollapsed]=useState(()=>sessionStorage.getItem('studio.roadmap.collapsed.'+taskId)==='1');
 const [showFindings,setShowFindings]=useState(false);
 const [source,setSource]=useState('');
 const groupKey=group?.version?group.id+'@'+group.version:'',showGroup=!!groupKey&&source===groupKey;
 const graph=useMemo(()=>{
  if(showGroup&&group)return layoutFrozenGroup(group.compiled);
  const plan=roadmap||legacyRoadmap(parameters);return plan?layoutRoadmap(plan,parameters,roadmap?'task':'legacy'):null;
 },[showGroup,group,roadmap,parameters]);
 const header=useRef<HTMLElement>(null),toggleRef=useRef<HTMLButtonElement>(null),restoreFocus=useRef(false);
 useLayoutEffect(()=>{
  const element=header.current,parent=element?.parentElement;if(!element||!parent)return;
  const update=()=>parent.style.setProperty('--workflow-header-height',element.offsetHeight+'px');update();
  const observer=new ResizeObserver(update);observer.observe(element);return ()=>observer.disconnect();
 },[]);
 useLayoutEffect(()=>{if(restoreFocus.current){toggleRef.current?.focus({preventScroll:true});restoreFocus.current=false;}},[collapsed]);
 function toggle(){
  sessionStorage.setItem('studio.roadmap.collapsed.'+taskId,collapsed?'0':'1');restoreFocus.current=true;setCollapsed(!collapsed);setShowFindings(false);
 }
 const bar=<><h2>{t('计算流程图')}</h2>
  {groupKey&&group&&<select aria-label={t('流程图范围')} value={showGroup?groupKey:''} onChange={e=>{setSource(e.target.value);setShowFindings(false);}}>
   <option value="">{t('整个计算流程')}</option><option value={groupKey}>{t('冻结工具组')} · {group.name}</option></select>}
  {graph&&graph.findings.length>0&&<button type="button" className="roadmap-findings-toggle" aria-expanded={showFindings} onClick={()=>setShowFindings(!showFindings)}>{t('待明确')} · {graph.findings.length}</button>}
  {!roadmap&&!showGroup&&<button type="button" className="roadmap-plan" onClick={onPlan}>{t('在对话中规划')}</button>}</>;
 const collapse=<button type="button" className="roadmap-collapse" ref={toggleRef} onClick={toggle} aria-expanded={true} aria-label={t('收起计算流程图')} title={t('收起计算流程图')}><ChevronUp size={16}/></button>;
 return <header ref={header} className="workflow-pinned-heading" data-testid="workflow-pinned-heading">
  <div className="roadmap-title-row"><h1 title={name}>{name}</h1>
   {collapsed&&<button type="button" ref={toggleRef} className="roadmap-mini" data-testid="roadmap-mini" onClick={toggle} aria-label={t('展开计算流程图')} title={t('展开计算流程图')} aria-expanded={false}>
    {graph?.nodes.length?<svg aria-hidden="true" viewBox={`0 0 ${graph.width} ${graph.height}`}><Graphic graph={graph} mini/></svg>:<span>{t('计算流程图')}</span>}<ChevronDown size={15}/></button>}
  </div>
  {!collapsed&&<section className="workflow-roadmap" aria-label={t('计算流程图')} data-testid="workflow-roadmap">
   {graph?.nodes.length?<RoadmapCanvas key={showGroup?groupKey:'task'} graph={graph} fields={fields} bar={bar} collapse={collapse} onField={onField} onDiscuss={onDiscuss}/>:<><div className="roadmap-bar">{bar}{collapse}</div><p className="roadmap-empty">{t('待定义初始输入、工具执行和目标产物。')}</p></>}
   {showFindings&&graph&&<div className="roadmap-findings" role="region" aria-label={t('待明确')}><ul>{graph.findings.map((message,index)=><li key={index}>{message}</li>)}</ul></div>}
  </section>}
 </header>;
}
