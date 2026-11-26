import Button from '../../ui/Button';
import Field from '../../ui/Field';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {t} from '../../ui/i18n';
import {inspectJsonDraft,isJsonObject,jsonDraftValueSource,type JsonDraft} from '../../ui/json-draft.mjs';

const interfaceJsonLabels={argv:'命令参数（JSON）',io:'输入输出（JSON）',test:'测试输入与资源（JSON）'} as const;
export type InterfaceJsonField=keyof typeof interfaceJsonLabels;
type Edit=(path:readonly (string|number)[],encoded?:string)=>void;
type Props={values:Record<InterfaceJsonField,string>;issue?:{field:InterfaceJsonField;message:string}|null;onRaw:(field:InterfaceJsonField,source:string)=>void;onEdit:(field:InterfaceJsonField,...args:Parameters<Edit>)=>void};
const portName=/^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
const jsonNumber=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const testNumbers=[
 {path:['max_seconds'],label:'最小测试时长（秒）',id:'max-seconds',min:1,max:600},
 {path:['resources','cpus'],label:'CPU 数（可选）',id:'cpus',min:1,max:2147483647},
 {path:['resources','gpus'],label:'GPU 数（可选）',id:'gpus',min:0,max:2147483647},
 {path:['resources','memory_mb'],label:'内存 MB（可选）',id:'memory-mb',min:1,max:2147483647},
] as const;

function AdvancedField(){
 return <small>{t('请在高级 JSON 中编辑此项。')}</small>;
}

function ArgumentsEditor({values,edit}:{values:string[];edit:Edit}){
 return <section className="resource-tool-arguments">
  <strong>{t('命令参数')}</strong>
  <small>{t('可引用 {input:名称}、{output:名称} 和 {param:名称}。')}</small>
  {values.map((value,index)=><div className="resource-tool-argument" key={index}>
   <label>{t('参数')} {index+1}<textarea data-testid="resource-tool-argument" rows={1} spellCheck={false} value={value} onChange={event=>edit([index],JSON.stringify(event.currentTarget.value))}/></label>
   <button className="text-button" type="button" aria-label={t('移除参数')+' '+(index+1)} onClick={()=>edit([index])}>{t('移除')}</button>
  </div>)}
  <Button  type="button" data-testid="resource-tool-add-argument" onClick={()=>edit([values.length],'""')}>{t('添加命令参数')}</Button>
 </section>;
}

function PortsEditor({direction,ports,edit}:{direction:'inputs'|'outputs';ports:unknown;edit:Edit}){
 const [name,setName]=useState(''),nameField=useRef<HTMLInputElement>(null);
 const input=direction==='inputs',mode=input?'input':'output';
 const canAdd=isJsonObject(ports)||ports===undefined;
 const entries=isJsonObject(ports)?ports:{};
 const duplicate=Object.hasOwn(entries,name);
 const ready=canAdd&&portName.test(name)&&!duplicate;
 function add(){
  if(!ready)return;
  edit([direction,name],JSON.stringify({filename:'',format:''}));
  nameField.current?.setCustomValidity('');
  setName('');
 }
 return <section className="resource-tool-ports">
  <strong>{t(input?'输入端口':'输出端口')}</strong>
  <small>{t(input?'工具需要文件输入时添加端口。':'至少添加一个最小测试可检查的输出。')}</small>
  {!canAdd&&<AdvancedField/>}
  {Object.entries(entries).map(([id,port])=><fieldset key={id} data-testid={'resource-tool-'+mode+'-port'} data-port-id={id}>
   <legend>{id}</legend>
   {isJsonObject(port)?<div className="resource-tool-grid">
    {(['filename','format'] as const).map(key=>port[key]!==undefined&&typeof port[key]!=='string'?<AdvancedField key={key}/>:
     <label key={key}>{t(key==='filename'?'作业文件名':'文件格式')}<input data-testid={'resource-tool-port-'+key} value={typeof port[key]==='string'?port[key]:''} onChange={event=>edit([direction,id,key],JSON.stringify(event.currentTarget.value))}/></label>)}
    {Object.keys(port).every(key=>key==='filename'||key==='format')&&<button className="text-button" type="button" aria-label={t('移除端口')+' '+id} onClick={()=>edit([direction,id])}>{t('移除')}</button>}
   </div>:<AdvancedField/>}
  </fieldset>)}
  {canAdd&&<>
   <div className="resource-tool-argument">
    <label>{t(input?'新输入端口名称':'新输出端口名称')}<input ref={node=>{
     nameField.current=node;
     node?.setCustomValidity(name?t('请添加端口或清空尚未应用的名称。'):'');
    }} data-testid={'resource-tool-'+mode+'-name'} placeholder={input?'input':'result'} value={name} onChange={event=>setName(event.currentTarget.value)}
     onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();add();}}}/></label>
    <Button  type="button" data-testid={'resource-tool-'+mode+'-port-add'} disabled={!ready} onClick={add}>{t(input?'添加输入端口':'添加输出端口')}</Button>
   </div>
   {name&&!ready&&<small>{t(duplicate?'同一组内的名称必须唯一。':'端口名称须以英文字母开头，可含字母、数字、连字符和下划线，最多 63 字符。')}</small>}
  </>}
 </section>;
}

function TestEditor({document,recipe,inputPorts,edit}:{document:JsonDraft;recipe:Record<string,unknown>;inputPorts:unknown;edit:Edit}){
 const testInputs=isJsonObject(recipe.inputs)?recipe.inputs:{};
 const resources=isJsonObject(recipe.resources)?recipe.resources:{};
 const ports=isJsonObject(inputPorts)?inputPorts:{};
 const canEditResources=recipe.resources===undefined||isJsonObject(recipe.resources);
 const canEditInputs=recipe.inputs===undefined||isJsonObject(recipe.inputs);
 const names=[...new Set([...Object.keys(ports),...Object.keys(testInputs)])];
 return <section className="resource-tool-test-fields">
  <strong>{t('最小测试')}</strong>
  <div className="resource-tool-grid">
   {testNumbers.map(({path,label,id,min,max})=>{
    const value=path.length===1?recipe.max_seconds:resources[path[1]];
    return path.length>1&&!canEditResources||value!==undefined&&typeof value!=='number'?<div key={id}><span>{t(label)}</span><AdvancedField/></div>:
     <label key={id}>{t(label)}<input type="number" min={min} max={max} step={1} data-testid={'resource-tool-test-'+id} value={jsonDraftValueSource(document,path)??''} onChange={event=>{
      const {value,validity}=event.currentTarget;
      if(!validity.badInput&&(!value||jsonNumber.test(value)))edit(path,value||undefined);
     }}/></label>;
   })}
   {canEditResources&&(resources.qos===undefined||typeof resources.qos==='string')?<label>{t('调度 QoS（可选）')}<input data-testid="resource-tool-test-qos" value={typeof resources.qos==='string'?resources.qos:''} onChange={event=>edit(['resources','qos'],event.currentTarget.value?JSON.stringify(event.currentTarget.value):undefined)}/></label>:<div><span>{t('调度 QoS（可选）')}</span><AdvancedField/></div>}
  </div>
  {!canEditInputs&&<AdvancedField/>}
  {canEditInputs&&names.map(name=>{
   const path=['inputs',name],configured=Object.hasOwn(testInputs,name),fixture=configured?testInputs[name]:undefined;
   const key=isJsonObject(fixture)&&Object.keys(fixture).length===1
    ? typeof fixture.path==='string'?'path':typeof fixture.text==='string'?'text':''
    : '';
   return <fieldset key={name} data-testid="resource-tool-test-input" data-port-id={name}>
    <legend>{t('测试输入')} · {name}</legend>
    {!Object.hasOwn(ports,name)&&<small>{t('此测试输入尚未对应输入端口。')}</small>}
    {configured&&!key?<AdvancedField/>:<div className="resource-tool-test-fields">
     <label>{t('测试输入来源')}<select data-testid="resource-tool-test-input-kind" value={key} onChange={event=>{
      const kind=event.currentTarget.value;
      edit(path,kind?JSON.stringify({[kind]:''}):undefined);
     }}><option value="">{t('请选择')}</option><option value="path">{t('远端文件')}</option><option value="text">{t('内嵌测试文本')}</option></select></label>
     {key==='path'&&<label>{t('已授权的远端绝对路径')}<input data-testid="resource-tool-test-input-value" value={(fixture as {path:string}).path} onChange={event=>edit([...path,key],JSON.stringify(event.currentTarget.value))}/></label>}
     {key==='text'&&<label>{t('内嵌测试文本')}<textarea data-testid="resource-tool-test-input-value" rows={2} value={(fixture as {text:string}).text} onChange={event=>edit([...path,key],JSON.stringify(event.currentTarget.value))}/></label>}
    </div>}
   </fieldset>;
  })}
 </section>;
}

export default function ResourceToolInterfaceEditor({values,issue,onRaw,onEdit}:Props){
 const [advanced,setAdvanced]=useState(false),advancedId=useId();
 useEffect(()=>{if(issue)setAdvanced(true);},[issue]);
 const argv=useMemo(()=>inspectJsonDraft(values.argv),[values.argv]);
 const io=useMemo(()=>inspectJsonDraft(values.io),[values.io]);
 const test=useMemo(()=>inspectJsonDraft(values.test),[values.test]);
 const ports=io&&!io.duplicateKeys&&isJsonObject(io.value)?io.value:null;
 const recipe=test&&!test.duplicateKeys&&isJsonObject(test.value)?test.value:null;
 return <div className="resource-tool-interface">
  {argv&&!argv.duplicateKeys&&Array.isArray(argv.value)&&argv.value.every(value=>typeof value==='string')
   ?<ArgumentsEditor values={argv.value} edit={(...args)=>onEdit('argv',...args)}/>:<p>{t(interfaceJsonLabels.argv)} · <AdvancedField/></p>}
  <div className="resource-tool-port-groups" hidden={!ports}>
   <PortsEditor direction="inputs" ports={ports?ports.inputs:null} edit={(...args)=>onEdit('io',...args)}/>
   <PortsEditor direction="outputs" ports={ports?ports.outputs:null} edit={(...args)=>onEdit('io',...args)}/>
  </div>
  {!ports&&<p>{t(interfaceJsonLabels.io)} · <AdvancedField/></p>}
  {recipe&&test?<TestEditor document={test} recipe={recipe} inputPorts={ports?.inputs} edit={(...args)=>onEdit('test',...args)}/>:<p>{t(interfaceJsonLabels.test)} · <AdvancedField/></p>}
  <section className="resource-tool-advanced">
   <Button  type="button" data-testid="resource-tool-advanced-json" aria-expanded={advanced} aria-controls={advancedId} onClick={()=>setAdvanced(previous=>!previous)}>{t('高级 JSON 配置')}</Button>
   <div id={advancedId} className="resource-tool-code-grid" hidden={!advanced}>
    {(['argv','io','test'] as const).map(field=><Field label={t(interfaceJsonLabels[field])} key={field} error={issue?.field===field?t(issue.message):undefined}>
     {props=><textarea {...props} data-testid={'resource-tool-'+field} spellCheck={false} rows={4} value={values[field]} onChange={event=>onRaw(field,event.currentTarget.value)}/>}
    </Field>)}
    <small>{t('每个端口填写 filename 和 format。可选 parameters 和 dependencies。')}</small>
    <small>{t('测试输入可给 path 或 text。max_seconds 设置时间上限。')}</small>
    <small>{t('缺少 Git 时，可在输入输出 JSON 中添加 git_bootstrap。填写 kind 为 archive，并提供 filename、executable 和 sha256。url 可省略，确认后再选本机归档或填写集群路径。')}</small>
   </div>
  </section>
 </div>;
}
