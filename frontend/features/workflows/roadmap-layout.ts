import {analyzeRoadmap,resolveRoadmapInput,type WorkflowRoadmap,type RoadmapPort,type RoadmapFinding} from '../../../contracts/workflows/roadmap.mjs';
import {t} from '../../ui/i18n';
import type {ToolGroupCompiled,ToolGroupRecord} from '../../../contracts/dto/tools';
import {caption,distinguish,type Caption} from './roadmap-caption';

export interface FrozenGroupView {taskId:string;workspaceId:string;record:ToolGroupRecord}

// Old conversation drafts identify the active engine and its files, but have no
// producer/consumer ports or requested products. Only project that known portion.
export function legacyRoadmap(parameters:Record<string,unknown>):WorkflowRoadmap|null{
 const engine=parameters.engine;
 if(typeof engine!=='string'||!engine.trim())return null;
 const files=Array.isArray(parameters.files)?parameters.files:[];
 const resources=files.flatMap((file,index)=>typeof file==='string'&&file.trim()
  ?[{id:'file-'+index,label:file,field:'files.'+index}]:[]);
 if(!resources.length)resources.push({id:'files',label:t('科学输入文件'),field:'files'});
 return {schema_version:1,resources,inputs:resources.map(item=>item.id),outputs:[],
  steps:[{id:'current',tool:engine,label:engine,inputs:resources.map(item=>({port:item.id,resource:item.id})),outputs:[]}]};
}

const messages:Record<RoadmapFinding['code'],string>={
 no_outputs:'待定义目标产物',input_needed:'待提供',ambiguous_file:'有同名文件，需指定来源',confirm:'待确认',no_source:'缺少来源',unused_input:'未连到目标产物',unused_step:'未连到目标产物',unused_resource:'未关联到端口或目标',
};
export type GraphNode={
 key:string;kind:'input'|'step'|'output'|'missing';label:string;caption:Caption;subtitle:string;issues:string[];notes:string[];
 x:number;y:number;width:number;height:number;column:number;inputs:RoadmapPort[];outputs:RoadmapPort[];
 field?:string;confirm?:boolean;requirements?:string[];outputPitch?:number;
 runtime?:Partial<Record<'top'|'bottom',{id:string;label:string;caption:Caption}>>;
};
export interface GraphEdge {from:string;to:string;resource:string;path:string}
export interface RoadmapDrawing {
 nodes:GraphNode[];edges:GraphEdge[];handoffs:{resource:string;caption:Caption;from:string;x:number;y:number}[];width:number;height:number;
 labels:Map<string,string>;formats:Map<string,string>;requirements:Map<string,string[]>;findings:string[];goalCount:number;
}
export function portY(node:GraphNode,side:'inputs'|'outputs',index:number){
 const count=node[side].length;
 const pitch=side==='outputs'?node.outputPitch||18:18;
 return node.height/2+(index-(count-1)/2)*Math.min(pitch,(node.height-14)/Math.max(1,count-1));
}
export const companionHeight=(name?:Caption)=>name?12+name.lines.length*14+8:0;
const point=(x:number,y:number)=>x+' '+y;

export function layoutRoadmap(plan:WorkflowRoadmap,parameters:Record<string,unknown>,source:'task'|'legacy'|'group'='task'):RoadmapDrawing{
 const {depths,goals,findings:allFindings}=analyzeRoadmap(plan,parameters);
 const findings=source==='group'?[]:source==='legacy'?allFindings.filter(item=>item.code==='no_outputs'||item.code==='input_needed'):allFindings;
 const labels=new Map(plan.resources.map(item=>[item.id,item.label]));
 const formats=new Map(plan.resources.map(item=>[item.id,item.format||'']));
 const requirements=new Map(plan.resources.map(item=>[item.id,item.requirements||[]]));
 const resourceById=new Map(plan.resources.map(item=>[item.id,item]));
 const resourceNames=new Map(plan.resources.map((r,i)=>[r.id,caption(r.label,r.short_label,r.id,t('资源')+' '+(i+1),true)]));
 distinguish([...resourceNames.values()]);
 const stepNames=plan.steps.map((s,i)=>caption(s.label,s.short_label,s.id,t('步骤')+' '+(i+1)));
 distinguish(stepNames);
 const nodes:GraphNode[]=[];
 const notesFor=(id:string,step=false)=>findings.filter(item=>(step?item.step:item.resource)===id).map(item=>t(messages[item.code]));
 const finalColumn=Math.max(0,...Object.values(depths))+1;
 function boundary(id:string,kind:'input'|'missing'|'output',column:number){
  const resource=resourceById.get(id)!,notes=notesFor(id);
  const field=kind==='input'?resource.field:undefined;
  const value=field?resolveRoadmapInput(parameters,resource).value:undefined;
  const values=Array.isArray(value)?(value.every(entry=>typeof entry==='string')?value:value.length?[value.length+' '+t('项')]:[]):
   value==null||value===''?[]:[typeof value==='object'?t('已填写'):String(value)];
  const role=t(kind==='input'?'初始输入':kind==='output'?'目标产物':'缺少来源');
  const goal=kind==='output'?goals.find(item=>item.output===id):undefined;
  const required=goal?.inputs.map(input=>labels.get(input)).join('、');
  const name=resourceNames.get(id)!;
  nodes.push({key:kind+':'+id,kind,label:resource.label,caption:name,subtitle:role,issues:notes,requirements:resource.requirements,notes:[...values.filter(v=>v&&v!==resource.label),...(resource.format?[resource.format]:[]),...(resource.requirements||[]),...(required?[t('所需初始输入')+' · '+required]:[])],
   field,confirm:notes.includes(t('待确认')),column,x:0,y:0,width:Math.max(82,name.width+53),height:Math.max(38,name.lines.length*19+13),inputs:[],outputs:[]});
 }
 plan.inputs.forEach(id=>boundary(id,'input',0));
 const produced=new Set(plan.steps.flatMap(step=>step.outputs.map(port=>port.resource)));
 const initial=new Set(plan.inputs);
 const consumed=new Set(plan.steps.flatMap(step=>step.inputs.map(port=>port.resource)));
 for(const id of new Set([...consumed,...plan.outputs])){
  if(!initial.has(id)&&!produced.has(id))boundary(id,'missing',0);
 }
 const final=new Set(plan.outputs);
 plan.steps.forEach((step,index)=>{
  const name=stepNames[index],runtime:NonNullable<GraphNode['runtime']>={};
  for(const side of ['top','bottom'] as const){
   const id=step.runtime?.[side];
   if(!id)continue;
   const display=step.runtime_labels?.[side],label=display?.label||id;
   runtime[side]={id,label,caption:caption(label,display?.short_label,id,t('运行组件'))};
  }
  const modules=Object.values(runtime);distinguish(modules.map(m=>m.caption));
  // Handoff names need separate tracks only on the side that carries them.
  const outputPitch=Math.max(18,...step.outputs.filter(p=>consumed.has(p.resource)&&!final.has(p.resource)).map(p=>resourceNames.get(p.resource)!.lines.length*14+10));
  const portHeight=Math.max((step.inputs.length-1)*14,(step.outputs.length-1)*outputPitch)+18;
  nodes.push({key:'step:'+step.id,kind:'step',label:step.label,caption:name,subtitle:step.tool,issues:notesFor(step.id,true),notes:[],
   x:0,y:0,width:Math.max(94,name.width+55,...modules.map(m=>m.caption.width*.8+28)),height:Math.max(44,name.lines.length*19+16,portHeight),
   column:depths[step.id],inputs:step.inputs,outputs:step.outputs,outputPitch,runtime:modules.length?runtime:undefined});
 });
 plan.outputs.forEach(id=>boundary(id,'output',finalColumn));
 const columns=Array.from({length:finalColumn+1},(_,index)=>nodes.filter(node=>node.column===index));
 const blockHeight=(node:GraphNode)=>node.height+companionHeight(node.runtime?.top?.caption)+companionHeight(node.runtime?.bottom?.caption);
 const gapY=15;
 const heights=columns.map(column=>column.reduce((sum,node)=>sum+blockHeight(node)+gapY,0)-gapY);
 const contentHeight=Math.max(68,...heights);
 const sources=new Map<string,{node:GraphNode;index:number}>();
 for(const node of nodes){
  if(node.kind==='step')node.outputs.forEach((port,index)=>sources.set(port.resource,{node,index}));
  else if(node.kind!=='output')sources.set(node.key.split(':')[1],{node,index:0});
 }
 const links=nodes.flatMap(node=>{
  const ports=node.kind==='output'?[{resource:node.key.slice(7)}]:node.inputs;
  return ports.flatMap((port,index)=>{const source=sources.get(port.resource);return source?[{source,node,index,resource:port.resource}]:[];});
 });
 // Long handoffs travel above intervening boxes, including their runtime annotations.
 const lanes=new Map<string,number>(),departures=columns.map(()=>new Set<string>()),arrivals=columns.map(()=>new Set<string>());
 const named=columns.map(()=>new Set<string>());
 for(const {source,node,resource} of links){
  if(source.node.kind==='step'&&!final.has(resource))named[source.node.column].add(resource);
  if(node.column-source.node.column<=1)continue;
  if(!lanes.has(resource))lanes.set(resource,lanes.size);
  departures[source.node.column].add(resource);arrivals[node.column].add(resource);
 }
 const tracks=named.map(ids=>ids.size?Math.max(...[...ids].map(id=>resourceNames.get(id)!.width*.8))+16:0);
 const overhead=lanes.size?8+lanes.size*10:0;
 let x=12,right=x;
 columns.forEach((column,index)=>{
  if(!column.length)return;
  const columnWidth=Math.max(...column.map(node=>node.width));
  let y=12+overhead+(contentHeight-heights[index])/2;
  for(const node of column){
   node.x=x;node.width=columnWidth;node.y=y+companionHeight(node.runtime?.top?.caption);
   y+=blockHeight(node)+gapY;
  }
  right=x+columnWidth;
  x=right+tracks[index]+36+8*(departures[index].size+(arrivals[index+1]?.size||0));
 });
 const handoffs:RoadmapDrawing['handoffs']=[];
 for(const ids of named)for(const resource of ids){
  const {node,index}=sources.get(resource)!,name=resourceNames.get(resource)!;
  handoffs.push({from:node.key,resource,caption:name,x:node.x+node.width+tracks[node.column]/2,y:node.y+portY(node,'outputs',index)});
 }
 const edges=links.map(({source,node,index,resource})=>{
  const from=source.node,ax=from.x+from.width,ay=from.y+(from.kind==='step'?portY(from,'outputs',source.index):from.height/2);
  const bx=node.x-4,by=node.y+(node.kind==='step'?portY(node,'inputs',index):node.height/2);
  const start=ax+tracks[from.column],mid=(start+bx)/2;
  let path='M '+point(ax,ay)+' H '+start+' C '+point(mid,ay)+' '+point(mid,by)+' '+point(bx,by);
  if(node.column-from.column>1){
   const lane=8+lanes.get(resource)!*10;
   const leave=start+12+[...departures[from.column]].indexOf(resource)*8;
   const enter=bx-12-[...arrivals[node.column]].indexOf(resource)*8;
   path='M '+point(ax,ay)+' H '+(leave-5)+' Q '+point(leave,ay)+' '+point(leave,ay-5)+' V '+(lane+5)+' Q '+point(leave,lane)+' '+point(leave+5,lane)+' H '+(enter-5)+' Q '+point(enter,lane)+' '+point(enter,lane+5)+' V '+(by-5)+' Q '+point(enter,by)+' '+point(enter+5,by)+' H '+bx;
  }
  return {from:from.key,to:node.key,resource,path};
 });
 const stepLabels=new Map(plan.steps.map(step=>[step.id,step.label]));
 const descriptions=findings.map(item=>[item.resource?labels.get(item.resource):item.step?stepLabels.get(item.step):'',t(messages[item.code])].filter(Boolean).join(' · '));
 return {nodes,edges,handoffs,labels,formats,requirements,findings:descriptions,goalCount:plan.outputs.length,width:Math.max(110,right+12),height:contentHeight+overhead+24};
}

// A frozen group already has resolved bindings. Project those exact ports, keeping
// defaults, literals and ordering-only dependencies distinct from produced artifacts.
export function layoutFrozenGroup(group:ToolGroupCompiled):RoadmapDrawing{
 const plan:WorkflowRoadmap={schema_version:1,resources:[],inputs:[],steps:[],outputs:[]};
 const notes=new Map<string,string[]>(),roles=new Map<string,string>();
 function resource(label:string,format?:string,short?:string){
  const id='r'+plan.resources.length;plan.resources.push({id,label,format,short_label:short&&short.length<=16?short:undefined});return id;
 }
 const initial=new Map(group.inputs.map(port=>[port.id,resource(port.description||port.id,port.format,port.id)]));
 plan.inputs.push(...initial.values());
 const outputPorts=new Map(group.steps.map(step=>[step.id,new Map(step.outputs.map(port=>[port.id,resource(port.description||port.id,port.format,port.id)]))]));
 for(const step of group.steps){
  const incoming=new Set<string>();
  const inputs=Object.entries(step.inputs).map(([port,value])=>{
   const binding=value as {kind:string;input_id:string;step_id:string;port_id:string;value?:unknown;behavior?:string};
   let id:string;
   if(binding.kind==='input')id=initial.get(binding.input_id)!;
   else if(binding.kind==='output'){id=outputPorts.get(binding.step_id)!.get(binding.port_id)!;incoming.add(binding.step_id);}
   else{
    id=resource(port);plan.inputs.push(id);roles.set(id,t(binding.kind==='default'?'默认输入':'固定输入'));
    notes.set('input:'+id,[binding.behavior||JSON.stringify(binding.value) || '']);
   }
   return {port,resource:id};
  });
  const orderOnly=step.depends_on.filter(id=>!incoming.has(id));
  notes.set('step:'+step.id,[step.package_version,...(orderOnly.length?[t('先决步骤')+' · '+orderOnly.join(', ')]:[])]);
  const tool=step.tool_id+' / '+step.function_id;
  plan.steps.push({id:step.id,tool,label:step.id+' · '+tool,short_label:step.id.length<=16?step.id:undefined,inputs,
   outputs:[...outputPorts.get(step.id)!].map(([port,id])=>({port,resource:id}))});
 }
 const aliases=new Map<string,string[]>();
 for(const out of group.outputs){
  const id=outputPorts.get(out.step_id)!.get(out.port_id)!;
  const names=aliases.get(id)||[];names.push(out.id);aliases.set(id,names);
 }
 plan.outputs.push(...aliases.keys());
 for(const item of plan.resources)if(aliases.has(item.id)){
  const names=aliases.get(item.id)!;
  if(item.label!==names.join(' / '))notes.set('output:'+item.id,[item.label]);
  item.label=names.join(' / ');item.short_label=names.length===1&&names[0].length<=16?names[0]:undefined;
 }
 const drawing=layoutRoadmap(plan,{},'group');
 for(const node of drawing.nodes){
  node.notes.push(...(notes.get(node.key)||[]));
  const id=node.key.split(':')[1];
  if(node.kind==='input')node.subtitle=roles.get(id)||t('工具组输入');
  if(node.kind==='output')node.subtitle=t('工具组产物');
 }
 return drawing;
}
