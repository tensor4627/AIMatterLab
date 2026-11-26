import Field from './Field';
import Disclosure from './Disclosure';
import Button from './Button';
import {parameterDisplayLabel} from "./parameter-label.mjs";

import {useState} from 'react';
import {FolderOpen,FileText,Plus,X} from 'lucide-react';
import {partitionFields} from "./task-fields.mjs";
import {inferField,parameterValue,fieldMissing,type TaskField} from "../../contracts/workflows/task-fields.mjs";

import {invoke} from '../api/studio';
import {wslPath} from './presentation/paths';
import {t} from './i18n';
export function ParameterFields({fields,parameters,onChange,onError,onPreview,onChooseFile,disabled=false,manualEdits}:{fields:TaskField[];parameters:Record<string,any>;manualEdits?:Readonly<Record<string,number>>;onChange:(key:string,value:any)=>void;onError:(error:unknown)=>void;onPreview?:(path:string)=>void;onChooseFile?:()=>Promise<string|null>;disabled?:boolean}){
 return <div className="parameter-fields">{fields.map(field=><ParameterInput key={field.key} field={field} value={parameterValue(parameters,field.key)} missing={fieldMissing(field,parameters)} onChange={value=>onChange(field.key,value)} onError={onError} onPreview={onPreview} onChooseFile={onChooseFile} disabled={disabled} manualEdits={manualEdits}/>)}</div>;
}
export function GroupedParameterFields(props:Parameters<typeof ParameterFields>[0]&{compact?:boolean}){
 const {primary,advanced}=partitionFields(props.fields);
 const shown=props.compact?primary.slice(0,4):primary,rest=props.compact?primary.slice(4):[];
 const hasMissing=(fields:TaskField[])=>fields.some(field=>fieldMissing(field,props.parameters));
 return <>
  <ParameterFields {...props} fields={shown}/>
  {rest.length>0&&<Disclosure variant="section" className="flow-parameter-details" forceOpen={hasMissing(rest)}
   summary={<>{t('更多基础参数')} · {rest.length}</>}><ParameterFields {...props} fields={rest}/></Disclosure>}
  {advanced.length>0&&<Disclosure variant="section" className="advanced-field-group" forceOpen={hasMissing(advanced)}
   summary={<>{t('高级参数')} <span className="tag">{advanced.length}</span></>}><ParameterFields {...props} fields={advanced}/></Disclosure>}
 </>;
}
function ParameterInput({field,value,missing,onChange,onError,onPreview,onChooseFile,disabled,manualEdits}:{field:TaskField;value:any;missing:boolean;onChange:(value:any)=>void;onError:(error:unknown)=>void;onPreview?:(path:string)=>void;onChooseFile?:()=>Promise<string|null>;disabled:boolean;manualEdits?:Readonly<Record<string,number>>}){
 const [advanced,setAdvanced]=useState(''),[emptyMatrix,setEmptyMatrix]=useState(false),[manualPath,setManualPath]=useState('');
 if(Array.isArray(value)&&(field.key==='files'||value.length>0&&value.every(v=>typeof v==='string'&&/^(?:[A-Za-z]:)?[\\/]/.test(v))))field={...field,type:'files'};

 const displayLabel=parameterDisplayLabel(field,manualEdits),recordedLabel=displayLabel!==field.label;
 const implicit=(value===undefined||value===null||value==='')&&!field.required&&Object.hasOwn(field,'default');if(implicit)value=field.default;
 async function pickFile(){if(onChooseFile)return onChooseFile();const selected=await invoke<string>('file.choose');return selected?wslPath(selected):null;}
 async function choose(){try{const file=await pickFile();if(file)onChange(file);}catch(e){onError(e);}}
 async function appendFile(){try{const file=await pickFile();if(!file)return;const items=Array.isArray(value)?value:[];if(!items.includes(file))onChange([...items,file]);}catch(e){onError(e);}}
 const grouped=['files','list','object'].includes(field.type);
 const control=(attrs:Parameters<React.ComponentProps<typeof Field>['children']>[0])=>{
 let widget;
 if(field.type==='files')widget=<div><Button aria-label={t('添加文件')} disabled={disabled} onClick={()=>void appendFile()}><FolderOpen size={14}/>{t('添加文件')}</Button><Disclosure className="manual-file-import" summary={t('手输文件路径')}><input aria-label={t('新文件路径')} disabled={disabled} value={manualPath} onChange={e=>setManualPath(e.target.value)}/><Button aria-label={t('添加路径')} disabled={disabled||!manualPath.trim()} onClick={()=>{const path=wslPath(manualPath.trim()),items=Array.isArray(value)?value:[];if(!items.includes(path))onChange([...items,path]);setManualPath('');}}>{t('添加路径')}</Button></Disclosure></div>;
 else if(field.type==='file')widget=<Button id={attrs.id} aria-describedby={attrs['aria-describedby']} disabled={disabled} onClick={()=>void choose()}><FolderOpen size={14}/>{t(value?'更换文件':'选择文件')}</Button>;
 else if(field.type==='boolean')widget=<span className="check-label"><input {...attrs} type="checkbox" disabled={disabled} checked={!!value} onChange={e=>onChange(e.target.checked)}/>{t(value?'是':'否')}</span>;
 else if(field.type==='select')widget=<select {...attrs} disabled={disabled} value={value??''} onChange={e=>onChange(e.target.value)}><option value="">{t('请选择')}</option>{field.options?.map(option=><option key={option} value={option}>{t(option)}</option>)}</select>;
 else if(['files','list'].includes(field.type)){
  const items=Array.isArray(value)?value:[];
  const pbc=field.type==='list'&&/(^|[._])pbc$/i.test(field.key)&&items.length===3&&items.every(item=>typeof item==='boolean');
  const matrix=field.type==='list'&&(items.length===0&&emptyMatrix||items.length>0&&items.length<=512&&items.every(row=>Array.isArray(row)&&row.length===3&&row.every(item=>item===null||typeof item==='number'&&Number.isFinite(item))));
  widget=pbc?<div className="pbc-axes">{items.map((item,index)=><span className="pbc-axis" key={index}><input disabled={disabled} aria-label={field.label+' '+['x','y','z'][index]} type="checkbox" checked={item} onChange={e=>onChange(items.map((value,i)=>i===index?e.target.checked:value))}/><span>{['x','y','z'][index]}</span><small>{t(item?'是':'否')}</small></span>)}</div>:matrix?<div className="parameter-matrix-wrapper"><small>{field.unit||''} · {t('行号从 0 开始')}</small><div className="parameter-matrix-scroll"><table className="parameter-matrix"><thead><tr><th>#</th>{['x','y','z'].map(axis=><th key={axis}>{axis}</th>)}<th/></tr></thead><tbody>{items.map((row,index)=><tr key={index}><th scope="row">{index}</th>{row.map((item:number|null,column:number)=><td key={column}><input disabled={disabled} aria-label={field.label+' '+index+' '+['x','y','z'][column]} type="number" step="any" value={item??''} onChange={e=>onChange(items.map((v,i)=>i===index?v.map((n:number|null,j:number)=>j===column?(e.target.value===''?null:Number(e.target.value)):n):v))}/></td>)}<td><Button variant="icon" size="sm" disabled={disabled} aria-label={t('删除行')+' '+index} onClick={()=>{if(items.length===1)setEmptyMatrix(true);onChange(items.filter((_,i)=>i!==index));}}><X size={13}/></Button></td></tr>)}</tbody></table></div><Button aria-label={t('添加行')} disabled={disabled||items.length>=512} onClick={()=>onChange([...items,[0,0,0]])}><Plus size={13}/>{t('添加行')}</Button></div>:<div className="parameter-list">{items.map((item,index)=><div className="parameter-list-row" key={index}>{item&&typeof item==='object'?<ParameterFields fields={Object.entries(item).map(([key,v])=>inferField(key,v))} parameters={item} disabled={disabled} onError={onError} onChange={(key,next)=>onChange(items.map((v,i)=>i!==index?v:Array.isArray(v)?v.map((item,j)=>String(j)===key?next:item):{...v,[key]:next}))}/>:typeof item==='boolean'?<input disabled={disabled} aria-label={field.label+' '+(index+1)} type="checkbox" checked={item} onChange={e=>onChange(items.map((v,i)=>i===index?e.target.checked:v))}/>:<input disabled={disabled} aria-label={field.label+' '+(index+1)} type={typeof item==='number'?'number':'text'} value={item??''} onChange={e=>onChange(items.map((v,i)=>i===index?(typeof item==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value):v))}/>}<Button variant="icon" size="sm" disabled={disabled} aria-label={t('删除条目')} onClick={()=>onChange(items.filter((_,i)=>i!==index))}><X size={13}/></Button></div>)}<div className="parameter-list-actions">{field.type==='files'&&<Button disabled={disabled} aria-label={t('选择文件')} onClick={()=>void appendFile()}><FolderOpen size={13}/>{t('选择文件')}</Button>}<Button disabled={disabled} onClick={()=>onChange([...items,typeof items[0]==='number'?0:typeof items[0]==='boolean'?false:''])}><Plus size={13}/>{t('添加条目')}</Button></div></div>;
 }else if(field.type==='object'){
  widget=<Disclosure className="advanced-parameters" summary={t('高级对象编辑')}><textarea disabled={disabled} value={advanced||JSON.stringify(value??{},null,2)} onChange={e=>setAdvanced(e.target.value)} onBlur={()=>{try{if(advanced){onChange(JSON.parse(advanced));setAdvanced('');}}catch(e){onError(e);}}}/></Disclosure>;
 }else if(field.type==='multiline')widget=<textarea {...attrs} disabled={disabled} rows={3} value={value??''} onChange={e=>onChange(e.target.value)}/>;
 else widget=<input {...attrs} disabled={disabled} type={['number','integer'].includes(field.type)?'number':'text'} step={field.type==='integer'?1:'any'} value={value??''} placeholder={missing?t('待补充'):t('未设置')} onChange={e=>onChange(['number','integer'].includes(field.type)?e.target.value===''?null:Number(e.target.value):e.target.value)}/>;
 return widget;
 };
 const hasDefault=Object.hasOwn(field,'default');
 const defaultSource=(hasDefault||field.default_source)?<>
  {hasDefault&&<span>{t(implicit?'使用引擎默认值':'引擎默认值')} · {JSON.stringify(field.default)}</span>}
  {field.default_source&&<div>{t('默认值来源')} · {field.default_source}</div>}
 </>:undefined;
 return <div className={'parameter-field '+(missing?'missing-field':'')} data-field={field.key}><Field
  label={<>{t(displayLabel)}{recordedLabel&&field.unit&&' · '+field.unit}</>} required={field.required}
  unit={field.unit&&['number','integer','text'].includes(field.type)&&!recordedLabel?field.unit:undefined}
  description={field.description} defaultSource={defaultSource} group={grouped} error={missing?t('待补充'):undefined}>
  {control}
 </Field>
 {hasDefault&&missing&&<Button size="sm" disabled={disabled} onClick={()=>onChange(field.default)}>{t('使用默认值')}</Button>}
 {recordedLabel&&<Disclosure className="parameter-notes" summary={t('来源与说明')}><p>{t('原始字段标签')} · {field.label}</p></Disclosure>}
{(field.type==='file'||field.type==='files')&&(field.type==='files'?Array.isArray(value)?value:[]:value?[value]:[]).filter((path:any)=>typeof path==='string'&&path).map((path:string,index:number)=><div className="parameter-file" key={path+index}><FileText size={13}/><strong title={path}>{path.split(/[\\/]/).at(-1)}</strong>{onPreview&&<Button disabled={disabled} aria-label={t('预览实际文件')+' '+path.split(/[\\/]/).at(-1)} onClick={()=>onPreview(path)}>{t('预览实际文件')}</Button>}<Disclosure summary={t('完整路径')}><input aria-label={t('文件路径')+' · '+path.split(/[\\/]/).at(-1)} value={path} disabled={disabled} onChange={e=>onChange(field.type==='files'?(value as string[]).map((v,i)=>i===index?e.target.value:v):e.target.value)}/></Disclosure><Button variant="icon" size="sm" aria-label={t('移除文件')+' · '+path.split(/[\\/]/).at(-1)} disabled={disabled} onClick={()=>onChange(field.type==='files'?(value as string[]).filter((_,i)=>i!==index):'')}><X size={13}/></Button></div>)}</div>;
}
