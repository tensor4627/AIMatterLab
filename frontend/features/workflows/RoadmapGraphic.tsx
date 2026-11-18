import {useId} from 'react';
import {Activity,CircleHelp,Cpu,LogIn,Package} from 'lucide-react';
import {t} from '../../ui/i18n';
import {companionHeight,portY,type GraphNode,type RoadmapDrawing} from './roadmap-layout';
import type {Caption} from './roadmap-caption';

export const roleStyle={
 input:{icon:LogIn,label:'输入'},step:{icon:Cpu,label:'工具'},
 output:{icon:Package,label:'输出'},missing:{icon:CircleHelp,label:'缺少来源'},
};

function Name({name,x,y,small=false,center=false}:{name:Caption;x:number;y:number;small?:boolean;center?:boolean}){
 const spacing=small?14:19;
 return <text className={small?'roadmap-small-name':'node-label'} textAnchor={center?'middle':'start'}>
  {name.lines.map((line,i)=><tspan key={i} x={x} y={y+(i-(name.lines.length-1)/2)*spacing} dominantBaseline="central">{line}</tspan>)}
 </text>;
}

function Shape({node}:{node:GraphNode}){
 const {width:w,height:h,kind}=node;
 if(kind!=='output')return <rect className="roadmap-box" width={w} height={h} rx={kind==='step'?7:h/2}/>;
 return <><path className="roadmap-box" d={`M6 0 H${w-12} L${w} 12 V${h-6} Q${w} ${h} ${w-6} ${h} H6 Q0 ${h} 0 ${h-6} V6 Q0 0 6 0 Z`}/>
  <path className="roadmap-fold" d={`M${w-12} 0 v9 q0 3 3 3 h9`}/></>;
}

export function RoadmapGraphic({graph,mini=false,selected}:{graph:RoadmapDrawing;mini?:boolean;selected?:string}){
 const arrow='roadmap-arrow-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
 const target=(name:string,key:string,role:string)=>mini?{}:{
  'data-full-name':name,'data-select-key':key,tabIndex:0,role:'button','aria-label':t(role)+' · '+name,'aria-expanded':selected===key,
 };
 return <>
  <defs><marker id={arrow} markerWidth="5" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L5 3 L0 6Z" fill="context-stroke"/></marker></defs>
  {graph.edges.map((edge,i)=><path key={i} d={edge.path} data-full-name={mini?undefined:graph.labels.get(edge.resource)}
   className={'roadmap-edge'+(selected===edge.from||selected===edge.to?' highlighted':'')+(edge.from.startsWith('missing:')?' unresolved':'')} markerEnd={'url(#'+arrow+')'}/>)}
  {graph.nodes.map(node=>{
   const {kind,width:w,height:h}=node,step=kind==='step',Icon=roleStyle[kind].icon;
   return <g key={node.key} transform={`translate(${node.x} ${node.y})`}>
    <g data-node-key={node.key} className={'roadmap-node '+kind+(selected===node.key?' selected':'')}
     {...target(node.label,node.key,roleStyle[kind].label)}>
     <Shape node={node}/>
     {!mini&&<>
      {step&&<rect className="roadmap-chip" x={10} y={h/2-13} width={26} height={26} rx={6}/>}
      <Icon className="roadmap-glyph" x={step?14:12} y={h/2-9} size={18} strokeWidth={1.8}/>
      <Name name={node.caption} x={step?43:37} y={h/2}/>
      {node.issues.length>0&&kind!=='missing'&&<g className="roadmap-issue" transform={`translate(${w-8} ${kind==='output'?h-2:2})`}>
       <circle r="5.5"/><path d="M0 -2.5v2.6 M0 2v.5"/></g>}
     </>}
     {step&&(['inputs','outputs'] as const).map(side=>node[side].map((port,i)=><circle
      key={side+port.port} className={'roadmap-port '+side} cx={side==='inputs'?0:w} cy={portY(node,side,i)} r={2.6}
      data-full-name={mini?undefined:port.port+' · '+graph.labels.get(port.resource)}/>))}
    </g>
    {(['top','bottom'] as const).map(side=>{
     const module=node.runtime?.[side];
     if(!module)return null;
     const {caption:name,label:full}=module;
     const top=side==='top',y=top?0:h,height=companionHeight(name)-12,width=name.width*.8+26;
     const center=y+(top?-1:1)*(10+height/2);
     return <g key={side} className="roadmap-runtime" data-side={side} {...target(full,node.key,'同次执行内调用')}>
      <path className="runtime-link" d={`M${w/2} ${y}v${top?-10:10}`}/><circle cx={w/2} cy={y} r={2}/>
      <rect x={(w-width)/2} y={center-height/2} width={width} height={height} rx={height/2}/>
      {!mini&&<><Activity x={(w-width)/2+5} y={center-6} size={12}/><Name small name={name} x={(w-width)/2+21} y={center}/></>}
     </g>;
    })}
   </g>;
  })}
  {!mini&&graph.handoffs.map(({resource,from,x,y,caption:name})=><g key={resource} className="roadmap-handoff"
   transform={`translate(${x} ${y})`} {...target(graph.labels.get(resource)!,from,'中间产物')}>
   <rect x={-(name.width*.8+6)/2} y={-(name.lines.length*14+4)/2} width={name.width*.8+6} height={name.lines.length*14+4} rx={4}/>
   <Name small center name={name} x={0} y={0}/>
  </g>)}
 </>;
}
