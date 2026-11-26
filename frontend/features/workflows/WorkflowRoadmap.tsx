import Button from '../../ui/Button';
import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,CircleAlert,Maximize,Minus,Plus,X} from 'lucide-react';
import type {WorkflowRoadmap as Roadmap} from '../../../contracts/workflows/roadmap.mjs';
import type {ToolGroupRecord} from '../../../contracts/dto/tools';
import {t} from '../../ui/i18n';
import {readPreference,writePreference} from '../../ui/preference-storage';
import Tooltip from '../../ui/Tooltip';
import {layoutFrozenGroup,layoutRoadmap,legacyRoadmap,type GraphNode,type RoadmapDrawing} from './roadmap-layout';
import {RoadmapGraphic,roleStyle} from './RoadmapGraphic';
import './workflow-roadmap.css';

type Camera={scale:number;x:number;y:number};
type Hint={text:string;x:number;top:number;bottom:number};
type Size={width:number;height:number;font:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,max));
const overviewColumns=6;

function NameHint({hint,size,id}:{hint:Hint;size:Size;id:string}){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const tip=ref.current!;
  tip.style.left=clamp(hint.x-tip.offsetWidth/2,4,size.width-tip.offsetWidth-4)+'px';
  const above=hint.top-tip.offsetHeight-7;
  tip.style.top=clamp(above>=4?above:hint.bottom+7,4,size.height-tip.offsetHeight-4)+'px';
 },[hint,size]);
 return <div ref={ref} id={id} className="roadmap-name-hint" role="tooltip">{hint.text}</div>;
}

function NodeDetail({node,graph,fields,onField,onDiscuss,close}:{node:GraphNode;graph:RoadmapDrawing;fields:string[];onField:(field:string)=>void;onDiscuss:(text:string)=>void;close:()=>void}){
 const {icon:Icon,label:role}=roleStyle[node.kind];
 const canLocate=node.field&&(fields.includes(node.field)||/^files\.\d+$/.test(node.field)&&fields.includes('files'));
 const ports=(side:'inputs'|'outputs')=>node[side].map(({port,resource})=><li key={port}>
  <code>{port}</code><span>{[graph.labels.get(resource),graph.formats.get(resource),...(graph.requirements.get(resource)||[])].filter(Boolean).join(' · ')}</span></li>);
 return <aside className="roadmap-node-detail" aria-label={t('节点详情')}>
  <div className="roadmap-detail-heading"><Icon size={17}/><strong>{node.label}</strong>
   <Tooltip asChild content={t('关闭节点详情')}><Button variant="icon" size="sm" tooltip={false} type="button" className="roadmap-icon" aria-label={t('关闭节点详情')} onClick={close}><X size={16}/></Button></Tooltip></div>
  <div className="roadmap-detail-body">
   <p>{[node.kind==='step'?t(role):'',node.subtitle,node.key.slice(node.key.indexOf(':')+1)].filter(Boolean).join(' · ')}</p>
   {!!node.issues.length&&<p className="roadmap-detail-issues">{node.issues.join(' · ')}</p>}
   {node.notes.map((note,i)=><p key={i}>{note}</p>)}
   {(['inputs','outputs'] as const).map(side=>node[side].length>0&&<div className="roadmap-detail-ports" key={side}>
    <strong>{t(side==='inputs'?'输入端口':'输出端口')}</strong><ul>{ports(side)}</ul></div>)}
   {node.runtime&&<p>{[t('同次执行内调用'),...Object.values(node.runtime).map(m=>m.id===m.label?m.label:m.label+' ('+m.id+')')].join(' · ')}</p>}
  </div>
  {(canLocate||node.confirm)&&<div className="roadmap-detail-actions">
   {canLocate&&<Button type="button"  onClick={()=>onField(node.field!)}>{t('定位参数')}</Button>}
   {node.confirm&&<Button type="button"  onClick={()=>onDiscuss([t(node.kind==='output'?'我确认把以下产物列入当前计算流程的交付目标':'我确认当前计算流程需要以下初始输入'),node.label+' ('+node.key+')',...(node.requirements||[])].join(' · '))}>{t('在对话中确认')}</Button>}
  </div>}
 </aside>;
}

function RoadmapCanvas({graph,bar,collapse,fields,onField,onDiscuss}:{graph:RoadmapDrawing;bar:ReactNode;collapse:ReactNode;fields:string[];onField:(field:string)=>void;onDiscuss:(text:string)=>void}){
 const svg=useRef<SVGSVGElement>(null),hintId=useId();
 const [size,setSize]=useState<Size>({width:640,height:184,font:18});
 const [view,setView]=useState<Camera|'fit'|null>(null),[active,setActive]=useState(false),[selection,select]=useState('');
 const [hint,setHint]=useState<Hint|null>(null);
 const drag=useRef<{id:number;x:number;y:number;moved:boolean;key:string;camera:Camera}|null>(null);
 useLayoutEffect(()=>{
  const element=svg.current!;
  const update=()=>{
   const {width,height}=element.getBoundingClientRect(),font=parseFloat(getComputedStyle(element).fontSize);
   if(width&&height)setSize(old=>old.width===width&&old.height===height&&old.font===font?old:{width,height,font});
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);window.addEventListener('studio:appearance',update);
  return ()=>{observer.disconnect();window.removeEventListener('studio:appearance',update);};
 },[]);
 const fit=Math.max(Number.EPSILON,Math.min((size.width-8)/graph.width,(size.height-8)/graph.height,1.35));
 // Fit the inputs and outputs of typical plans on entry. Longer chains open at a readable scale.
 const long=graph.nodes.some(node=>node.column>=overviewColumns);
 const scale=view==='fit'||!long?fit:Math.max(fit,size.font/22);
 const camera=typeof view==='object'&&view?view:{
  scale,x:Math.max(4,(size.width-graph.width*scale)/2),y:Math.max(4,(size.height-graph.height*scale)/2),
 };
 const latest=useRef({camera,fit});latest.current={camera,fit};
 function zoom(x:number,y:number,multiplier:number){
  setHint(null);
  setView(previous=>{
   const old=previous&&previous!=='fit'?previous:latest.current.camera;
   const next=clamp(old.scale*multiplier,Math.min(.5,latest.current.fit),4),ratio=next/old.scale;
   return {scale:next,x:x-(x-old.x)*ratio,y:y-(y-old.y)*ratio};
  });
 }
 useEffect(()=>{
  const element=svg.current;if(!element||!active)return;
  const wheel=(e:WheelEvent)=>{
   e.preventDefault();const rect=element.getBoundingClientRect();
   const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?rect.height:1);
   zoom(e.clientX-rect.left,e.clientY-rect.top,Math.exp(-clamp(delta,-360,360)*.0025));
  };
  element.addEventListener('wheel',wheel,{passive:false});return ()=>element.removeEventListener('wheel',wheel);
 },[active]);
 function focusName(target:Element,pointer?:{x:number;y:number}){
  const item=target.closest<SVGGraphicsElement>('[data-full-name]'),box=svg.current!.getBoundingClientRect();
  if(!item||drag.current){setHint(null);return;}
  const bounds=item.getBoundingClientRect();
  let x=bounds.x-box.x,y=bounds.y-box.y;
  if(!pointer){
   // Keyboard traversal also brings off-screen nodes into the readable viewport.
   const dx=clamp(x,6,size.width-bounds.width-6)-x,dy=clamp(y,6,size.height-bounds.height-6)-y;
   if(dx||dy){setView({...camera,x:camera.x+dx,y:camera.y+dy});x+=dx;y+=dy;}
  }
  setHint({text:item.dataset.fullName!,x:pointer?pointer.x-box.x:x+bounds.width/2,
   top:pointer?pointer.y-box.y:y,bottom:pointer?pointer.y-box.y+6:y+bounds.height});
 }
 function choose(key:string){setHint(null);select(old=>old===key?'':key);}
 function fitAll(){setHint(null);setView('fit');}
 const selected=graph.nodes.find(node=>node.key===selection);
 return <><div className="roadmap-bar">{bar}<div className="roadmap-view-tools">
  {([[Minus,'缩小流程图',()=>zoom(size.width/2,size.height/2,.78)],[Plus,'放大流程图',()=>zoom(size.width/2,size.height/2,1.28)],[Maximize,'适应全图',fitAll]] as const).map(([Icon,label,click])=>
   <Tooltip key={label} asChild content={t(label)}><Button variant="icon" size="sm" tooltip={false} type="button" aria-label={t(label)} onClick={click}><Icon size={15}/></Button></Tooltip>)}
 </div>{collapse}</div>
 <div className="roadmap-surface">
  <svg ref={svg} className={'roadmap-canvas'+(active?' active':'')} style={{height:`clamp(104px, ${graph.height+14}px, min(28vh, 268px))`}} tabIndex={0}
   role="group" aria-label={t('计算流程图，点击后可拖动和滚轮缩放')} aria-describedby={hint?hintId:undefined}
   onFocus={e=>{setActive(true);if(e.target!==e.currentTarget)focusName(e.target as Element);}}
   onBlur={e=>{setHint(null);if(!e.currentTarget.contains(e.relatedTarget as Node))setActive(false);}}
   onPointerOver={e=>{if(e.pointerType!=='touch')focusName(e.target as Element,{x:e.clientX,y:e.clientY});}}
   onPointerLeave={()=>setHint(null)}
   onPointerDown={e=>{
    if(e.button!==0||drag.current)return;
    const key=(e.target as Element).closest('[data-select-key]')?.getAttribute('data-select-key')||'';
    e.currentTarget.focus({preventScroll:true});setActive(true);setHint(null);
    drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,key,camera};
    e.currentTarget.setPointerCapture(e.pointerId);
   }}
   onPointerMove={e=>{
    const start=drag.current;if(!start||start.id!==e.pointerId)return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!start.moved&&Math.hypot(dx,dy)<4)return;
    start.moved=true;setView({...start.camera,x:start.camera.x+dx,y:start.camera.y+dy});
   }}
   onPointerUp={e=>{
    const start=drag.current;if(!start||start.id!==e.pointerId)return;drag.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(!start.moved)choose(start.key);
   }}
   onLostPointerCapture={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
   onKeyDown={e=>{
    const key=(e.target as Element).closest('[data-select-key]')?.getAttribute('data-select-key');
    const moves:Record<string,[number,number]>={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};
    if(key&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(key);}
    else if(e.key in moves){e.preventDefault();setHint(null);const [x,y]=moves[e.key];setView({...camera,x:camera.x+x,y:camera.y+y});}
    else if(['+','=','-','Home','Escape'].includes(e.key)){
     e.preventDefault();if(e.key==='Escape'){select('');setHint(null);setActive(false);svg.current?.blur();}
     else if(e.key==='Home')fitAll();else zoom(size.width/2,size.height/2,e.key==='-'?.78:1.28);
    }
   }}>
   <g data-testid="roadmap-transform" transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}><RoadmapGraphic graph={graph} selected={selection}/></g>
  </svg>
  {hint&&<NameHint hint={hint} size={size} id={hintId}/>}
 </div>
 {selected&&<NodeDetail node={selected} graph={graph} fields={fields} onField={onField} onDiscuss={onDiscuss}
  close={()=>{select('');svg.current?.querySelector<SVGElement>('[data-node-key="'+CSS.escape(selected.key)+'"]')?.focus({preventScroll:true});setHint(null);}}/>}
 </>;
}

export default function WorkflowRoadmap({taskId,name,roadmap,parameters,group,fields,onField,onPlan,onDiscuss}:{taskId:string;name:string;roadmap?:Roadmap;parameters:Record<string,unknown>;group?:ToolGroupRecord;fields:string[];onField:(field:string)=>void;onPlan:()=>void;onDiscuss:(text:string)=>void}){
 const savedPreference=readPreference('studio.roadmap.collapsed.'+taskId,true);
 const manualCollapse=useRef(savedPreference==='0'||savedPreference==='1');
 const [collapsed,setCollapsed]=useState(()=>savedPreference==='1');
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
 useLayoutEffect(()=>{
  if(manualCollapse.current||typeof ResizeObserver!=='function')return;
  const container=header.current?.closest?.('.workspace-content')||header.current?.parentElement;
  if(!container)return;
  const adapt=()=>{
   if(manualCollapse.current)return;
   const height=container.clientHeight;
   if(height>0&&height<460)setCollapsed(true);
   else if(height>=520)setCollapsed(false);
  };
  adapt();
  const observer=new ResizeObserver(adapt);observer.observe(container);
  return ()=>observer.disconnect();
 },[taskId]);
 useLayoutEffect(()=>{if(restoreFocus.current){toggleRef.current?.focus({preventScroll:true});restoreFocus.current=false;}},[collapsed]);
 function toggle(){
  manualCollapse.current=true;writePreference('studio.roadmap.collapsed.'+taskId,collapsed?'0':'1',true);restoreFocus.current=true;setCollapsed(!collapsed);setShowFindings(false);
 }
 const bar=<><h2>{t('计算流程图')}</h2>
  {graph&&graph.nodes.length>0&&<ul className="roadmap-legend" aria-label={t('节点类型')}>
   {(['input','step','output'] as const).filter(kind=>graph.nodes.some(node=>node.kind===kind||(kind==='input'&&node.kind==='missing'))).map(kind=>{
    const {icon:Icon,label}=roleStyle[kind];return <li className={kind} key={kind}><Icon size={14}/>{t(label)}</li>;
   })}
  </ul>}
  {groupKey&&group&&<select aria-label={t('流程图范围')} value={showGroup?groupKey:''} onChange={e=>{setSource(e.target.value);setShowFindings(false);}}>
   <option value="">{t('整个计算流程')}</option><option value={groupKey}>{t('冻结工具组')} · {group.name}</option></select>}
  {graph&&graph.findings.length>0&&<button type="button" className="roadmap-findings-toggle" aria-expanded={showFindings} onClick={()=>setShowFindings(!showFindings)}><CircleAlert size={14}/>{t('待明确')} {graph.findings.length}</button>}
  {!roadmap&&!showGroup&&<button type="button" className="roadmap-plan" onClick={onPlan}>{t('在对话中规划')}</button>}</>;
 const collapse=<Tooltip asChild content={t('收起计算流程图')}><Button variant="icon" size="sm" tooltip={false} type="button" className="roadmap-collapse" ref={toggleRef} onClick={toggle} aria-expanded={true} aria-label={t('收起计算流程图')}><ChevronUp size={16}/></Button></Tooltip>;
 return <header ref={header} className="workflow-pinned-heading" data-testid="workflow-pinned-heading">
  <div className="roadmap-title-row"><h1 title={name}>{name}</h1>
   {collapsed&&<Tooltip asChild content={t('展开计算流程图')}><button type="button" ref={toggleRef} className="roadmap-mini" data-testid="roadmap-mini" onClick={toggle} aria-label={t('展开计算流程图')} aria-expanded={false}>
    {graph?.nodes.length?<svg aria-hidden="true" viewBox={`0 0 ${graph.width} ${graph.height}`}><RoadmapGraphic graph={graph} mini/></svg>:<span>{t('计算流程图')}</span>}<ChevronDown size={15}/></button></Tooltip>}
  </div>
  {!collapsed&&<section className="workflow-roadmap" aria-label={t('计算流程图')} data-testid="workflow-roadmap">
   {graph?.nodes.length?<RoadmapCanvas key={showGroup?groupKey:'task'} graph={graph} fields={fields} bar={bar} collapse={collapse} onField={onField} onDiscuss={onDiscuss}/>:<><div className="roadmap-bar">{bar}{collapse}</div><p className="roadmap-empty">{t('待定义初始输入、工具执行和目标产物。')}</p></>}
   {showFindings&&graph&&<div className="roadmap-findings" role="region" aria-label={t('待明确')}><ul>{graph.findings.map((message,index)=><li key={index}>{message}</li>)}</ul></div>}
  </section>}
 </header>;
}
