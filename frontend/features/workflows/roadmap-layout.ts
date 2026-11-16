import {analyzeRoadmap,resolveRoadmapInput,type WorkflowRoadmap,type RoadmapPort,type RoadmapFinding} from '../../../contracts/workflows/roadmap.mjs';
import {t} from '../../ui/i18n';
import type {ToolGroupCompiled,ToolGroupRecord} from '../../../contracts/dto/tools';

export interface FrozenGroupView {taskId:string;workspaceId:string;record:ToolGroupRecord}

// Old conversation drafts identify the active engine and its files, but have no
// producer/consumer ports or requested products. Only project that known portion.
export function legacyRoadmap(parameters:Record<string,unknown>):WorkflowRoadmap|null{
 const engine=parameters.engine;
 if(typeof engine!=='string'||!engine.trim())return null;
 const files=Array.isArray(parameters.files)?parameters.files:[];
 const resources=files.flatMap((file,index)=>typeof file==='string'&&file.trim()
  ?[{id:'file-'+index,label:file.split(/[\\/]/).at(-1)||file,field:'files.'+index}]:[]);
 if(!resources.length)resources.push({id:'files',label:t('科学输入文件'),field:'files'});
 return {schema_version:1,resources,inputs:resources.map(item=>item.id),outputs:[],
  steps:[{id:'current',tool:engine,label:t('当前计算'),inputs:resources.map(item=>({port:item.id,resource:item.id})),outputs:[]}]};
}

const messages:Record<RoadmapFinding['code'],string>={
 no_outputs:'待定义目标产物',input_needed:'待提供',ambiguous_file:'有同名文件，需指定来源',confirm:'待确认',no_source:'缺少来源',unused_input:'未连到目标产物',unused_step:'未连到目标产物',unused_resource:'未关联到端口或目标',
};
export type GraphNode={
 key:string;kind:'input'|'step'|'output'|'missing';label:string;subtitle:string;notes:string[];
 x:number;y:number;width:number;height:number;column:number;inputs:RoadmapPort[];outputs:RoadmapPort[];
 field?:string;confirm?:boolean;requirements?:string[];runtime?:{top?:string;bottom?:string};
};
export interface GraphEdge {from:string;to:string;resource:string;path:string}
export interface RoadmapDrawing {
 nodes:GraphNode[];edges:GraphEdge[];width:number;height:number;
 labels:Map<string,string>;formats:Map<string,string>;requirements:Map<string,string[]>;findings:string[];goalCount:number;
}
export const portY=(index:number)=>61+index*20;
const point=(x:number,y:number)=>x+' '+y;

export function layoutRoadmap(plan:WorkflowRoadmap,parameters:Record<string,unknown>,source:'task'|'legacy'|'group'='task'):RoadmapDrawing{
 const {depths,goals,findings:allFindings}=analyzeRoadmap(plan,parameters);
 const findings=source==='group'?[]:source==='legacy'?allFindings.filter(item=>item.code==='no_outputs'||item.code==='input_needed'):allFindings;
 const labels=new Map(plan.resources.map(item=>[item.id,item.label]));
 const formats=new Map(plan.resources.map(item=>[item.id,item.format||'']));
 const requirements=new Map(plan.resources.map(item=>[item.id,item.requirements||[]]));
 const resourceById=new Map(plan.resources.map(item=>[item.id,item]));
 const nodes:GraphNode[]=[];
 const notesFor=(id:string,step=false)=>findings.filter(item=>(step?item.step:item.resource)===id).map(item=>t(messages[item.code]));
 const finalColumn=Math.max(0,...Object.values(depths))+1;
 function boundary(id:string,kind:'input'|'missing'|'output',column:number){
  const resource=resourceById.get(id)!,notes=notesFor(id);
  const field=kind==='input'?resource.field:undefined;
  const value=field?resolveRoadmapInput(parameters,resource).value:undefined;
  const detail=value===undefined||value===null||value===''||Array.isArray(value)&&!value.length?'':typeof value==='object'?
   (Array.isArray(value)?value.length+' '+t('项'):t('已填写')):String(value);
  const role=t(kind==='input'?'初始输入':kind==='output'?'目标产物':'缺少来源');
  const summary=[role,...notes.filter(note=>note!==role)].join(' · ');
  const goal=kind==='output'?goals.find(item=>item.output===id):undefined;
  const required=goal?.inputs.map(input=>labels.get(input)).join('、');
  nodes.push({key:kind+':'+id,kind,label:resource.label,subtitle:summary,requirements:resource.requirements,notes:[...notes,...(detail?[detail]:[]),...(resource.format?[resource.format]:[]),...(resource.requirements||[]),...(required?[t('所需初始输入')+' · '+required]:[])],
   field,confirm:notes.includes(t('待确认')),column,x:0,y:0,width:158,height:56,inputs:[],outputs:[]});
 }
 plan.inputs.forEach(id=>boundary(id,'input',0));
 const produced=new Set(plan.steps.flatMap(step=>step.outputs.map(port=>port.resource)));
 const initial=new Set(plan.inputs);
 for(const id of new Set(plan.steps.flatMap(step=>step.inputs.map(port=>port.resource)))){
  if(!initial.has(id)&&!produced.has(id))boundary(id,'missing',0);
 }
 for(const step of plan.steps){
  nodes.push({key:'step:'+step.id,kind:'step',label:step.label,subtitle:step.tool,notes:notesFor(step.id,true),
   x:0,y:0,width:256,height:Math.max(65,portY(Math.max(step.inputs.length,step.outputs.length)-1)+15),
   column:depths[step.id],inputs:step.inputs,outputs:step.outputs,runtime:step.runtime});
 }
 plan.outputs.forEach(id=>boundary(id,'output',finalColumn));
 const columns=Array.from({length:finalColumn+1},(_,index)=>nodes.filter(node=>node.column===index));
 const blockHeight=(node:GraphNode)=>node.height+(node.runtime?.top?38:0)+(node.runtime?.bottom?38:0);
 const heights=columns.map(column=>column.reduce((sum,node)=>sum+blockHeight(node)+20,0)-20);
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
 const lanes=new Map<string,number>();
 for(const link of links)if(link.node.column-link.source.node.column>1&&!lanes.has(link.resource))lanes.set(link.resource,lanes.size);
 const overhead=lanes.size?12+lanes.size*10:0;
 let x=16;
 columns.forEach((column,index)=>{
  if(!column.length)return;
  let y=12+overhead+(contentHeight-heights[index])/2;
  for(const node of column){
   node.x=x;node.y=y+(node.runtime?.top?38:0);
   y+=blockHeight(node)+20;
  }
  x+=Math.max(...column.map(node=>node.width))+58;
 });
 const edges=links.map(({source,node,index,resource})=>{
  const from=source.node,ax=from.x+from.width,ay=from.y+(from.kind==='step'?portY(source.index):from.height/2);
  const bx=node.x,by=node.y+(node.kind==='step'?portY(index):node.height/2);
  const mid=(ax+bx)/2;
  let path='M '+point(ax,ay)+' C '+point(mid,ay)+' '+point(mid,by)+' '+point(bx,by);
  if(node.column-from.column>1){
   const lane=9+(lanes.get(resource)||0)*10;
   path='M '+point(ax,ay)+' H '+(ax+18)+' V '+lane+' H '+(bx-18)+' V '+by+' H '+bx;
  }
  return {from:from.key,to:node.key,resource,path};
 });
 const stepLabels=new Map(plan.steps.map(step=>[step.id,step.label]));
 const descriptions=findings.map(item=>[item.resource?labels.get(item.resource):item.step?stepLabels.get(item.step):'',t(messages[item.code])].filter(Boolean).join(' · '));
 return {nodes,edges,labels,formats,requirements,findings:descriptions,goalCount:plan.outputs.length,width:Math.max(140,x-58+16),height:contentHeight+overhead+24};
}

// A frozen group already has resolved bindings. Project those exact ports, keeping
// defaults, literals and ordering-only dependencies distinct from produced artifacts.
export function layoutFrozenGroup(group:ToolGroupCompiled):RoadmapDrawing{
 const plan:WorkflowRoadmap={schema_version:1,resources:[],inputs:[],steps:[],outputs:[]};
 const notes=new Map<string,string[]>(),roles=new Map<string,string>();
 function resource(label:string,format?:string){
  const id='r'+plan.resources.length;plan.resources.push({id,label,format});return id;
 }
 const initial=new Map(group.inputs.map(port=>[port.id,resource(port.id,port.format)]));
 plan.inputs.push(...initial.values());
 const outputPorts=new Map(group.steps.map(step=>[step.id,new Map(step.outputs.map(port=>[port.id,resource(port.id,port.format)]))]));
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
  plan.steps.push({id:step.id,tool:step.tool_id+' / '+step.function_id,label:step.id,inputs,
   outputs:[...outputPorts.get(step.id)!].map(([port,id])=>({port,resource:id}))});
 }
 const aliases=new Map<string,string[]>();
 for(const out of group.outputs){
  const id=outputPorts.get(out.step_id)!.get(out.port_id)!;
  const names=aliases.get(id)||[];names.push(out.id);aliases.set(id,names);
 }
 plan.outputs.push(...aliases.keys());
 const drawing=layoutRoadmap(plan,{},'group');
 for(const node of drawing.nodes){
  node.notes.push(...(notes.get(node.key)||[]));
  const id=node.key.split(':')[1];
  if(node.kind==='input')node.subtitle=roles.get(id)||t('工具组输入');
  if(node.kind==='output'){node.label=aliases.get(id)!.join(' / ');node.subtitle=t('工具组产物');}
 }
 return drawing;
}
