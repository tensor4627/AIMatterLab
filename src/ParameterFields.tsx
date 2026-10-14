import {useState} from 'react';
import {FolderOpen,FileText,Plus,X} from 'lucide-react';
import {inferField,parameterValue,fieldMissing,type TaskField} from '../shared/task-fields.mjs';
import {invoke,wslPath} from './types';
import {t} from './i18n';
export function ParameterFields({fields,parameters,onChange,onError,disabled=false}:{fields:TaskField[];parameters:Record<string,any>;onChange:(key:string,value:any)=>void;onError:(error:unknown)=>void;disabled?:boolean}){
 return <div className="parameter-fields">{fields.map(field=><ParameterInput key={field.key} field={field} value={parameterValue(parameters,field.key)} missing={fieldMissing(field,parameters)} onChange={value=>onChange(field.key,value)} onError={onError} disabled={disabled}/>)}</div>;
}
function ParameterInput({field,value,missing,onChange,onError,disabled}:{field:TaskField;value:any;missing:boolean;onChange:(value:any)=>void;onError:(error:unknown)=>void;disabled:boolean}){
 const [advanced,setAdvanced]=useState('');
 async function choose(){try{const path=await invoke<string>('file.choose');if(path)onChange(wslPath(path));}catch(e){onError(e);}}
 let control;
 if(field.type==='boolean')control=<span className="check-label"><input type="checkbox" disabled={disabled} checked={!!value} onChange={e=>onChange(e.target.checked)}/>{t(value?'是':'否')}</span>;
 else if(field.type==='select')control=<select disabled={disabled} value={value??''} onChange={e=>onChange(e.target.value)}><option value="">{t('请选择')}</option>{field.options?.map(option=><option key={option} value={option}>{t(option)}</option>)}</select>;
 else if(['files','list'].includes(field.type)){
  const items=Array.isArray(value)?value:[];
  control=<div className="parameter-list">{items.map((item,index)=><div className="parameter-list-row" key={index}>{item&&typeof item==='object'?<ParameterFields fields={Object.entries(item).map(([key,v])=>inferField(key,v))} parameters={item} disabled={disabled} onError={onError} onChange={(key,next)=>onChange(items.map((v,i)=>i===index?{...v,[key]:next}:v))}/>:<input disabled={disabled} aria-label={field.label+' '+(index+1)} type={typeof item==='number'?'number':'text'} value={item??''} onChange={e=>onChange(items.map((v,i)=>i===index?(typeof item==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value):v))}/>}<button className="icon-button" disabled={disabled} aria-label={t('删除条目')} onClick={()=>onChange(items.filter((_,i)=>i!==index))}><X size={13}/></button></div>)}<button className="button" disabled={disabled} onClick={()=>onChange([...items,typeof items[0]==='number'?0:''])}><Plus size={13}/>{t('添加条目')}</button></div>;
 }else if(field.type==='object'){
  control=<details className="advanced-parameters"><summary>{t('高级对象编辑')}</summary><textarea disabled={disabled} value={advanced||JSON.stringify(value??{},null,2)} onChange={e=>setAdvanced(e.target.value)} onBlur={()=>{try{if(advanced){onChange(JSON.parse(advanced));setAdvanced('');}}catch(e){onError(e);}}}/></details>;
 }else if(field.type==='multiline')control=<textarea disabled={disabled} rows={3} value={value??''} onChange={e=>onChange(e.target.value)}/>;
 else control=<div className="parameter-control"><input disabled={disabled} type={['number','integer'].includes(field.type)?'number':'text'} step={field.type==='integer'?1:'any'} value={value??''} placeholder={missing?t('待补充'):t('未设置')} onChange={e=>onChange(['number','integer'].includes(field.type)?e.target.value===''?null:Number(e.target.value):e.target.value)}/>{field.unit&&<span className="parameter-unit">{field.unit}</span>}{field.type==='file'&&<button className="icon-button" disabled={disabled} aria-label={t('选择文件')} onClick={()=>void choose()}><FolderOpen size={16}/></button>}</div>;
 return <div className={'parameter-field '+(missing?'missing-field':'')} data-field={field.key}><label><span>{t(field.label)}{field.required&&<span className="required-mark"> *</span>}</span>{control}</label>{field.description&&<small>{field.description}</small>}{field.type==='file'&&value&&<div className="parameter-file"><FileText size={13}/><strong>{String(value).split(/[\\/]/).at(-1)}</strong><span title={String(value)}>{String(value)}</span></div>}</div>;
}
