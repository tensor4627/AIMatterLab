import Button from '../../ui/Button';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {tr} from '../../ui/i18n';
import {inspectResumeParameters,replaceResumeParameter} from './resume-parameters.mjs';
import './resume-parameters.css';

const runInput={key:'continuation_run_in',label:'续算 run.in 路径'};
const pythonScript={key:'continuation_script',label:'续算脚本路径'};
const fieldsByEngine=new Map([
 ['gpumd.md',[runInput]],
 ['gpumd.sampling',[runInput]],
 ['hotpp.train',[{key:'checkpoint',label:'HotPP checkpoint 文件名'},{key:'continuation_config',label:'续算配置文件路径'}]],
 ['pydyn.md',[pythonScript]],
 ['pydyn.sampling',[pythonScript,{key:'paired_manifest',label:'配对 checkpoint 清单文件名'}]],
]);

export default function ResumeParametersEditor({engine,value,onChange,disabled}:{engine:string;value:string;onChange:(source:string)=>void;disabled:boolean}){
 let inspection:ReturnType<typeof inspectResumeParameters>|undefined,error='';
 try{inspection=inspectResumeParameters(value);error=inspection.issue||'';}catch(cause){error=cause instanceof Error?cause.message:String(cause);}
 const parameters=inspection?.parameters;
 const checkpointFiles=parameters?.checkpoint_files;
 const names=checkpointFiles===undefined?[]:Array.isArray(checkpointFiles)&&checkpointFiles.every(name=>typeof name==='string'&&!/[\r\n]/.test(name))?checkpointFiles as string[]:null;
 const rows=names?.length?names:[''];
 const gpumd=engine==='gpumd.md'||engine==='gpumd.sampling';
 const update=(key:string,next:string|string[])=>{if(inspection)onChange(replaceResumeParameter(inspection.document,key,next));};
 const editAsJson=<small>{tr('请在高级 JSON 中编辑此字段。')}</small>;

 return <div className="resume-parameters">
  {parameters&&<>
   <fieldset className="resume-checkpoints">
    <legend>{tr('Checkpoint 文件')}</legend>
    <p className="muted">{tr(gpumd?'填写父运行结果目录中的相对文件名，GPUMD 需要 restart.xyz。':'填写相对于父运行结果目录的文件名。')}</p>
    {names===null?editAsJson:<>
     {rows.map((name,index)=><div className="resume-checkpoint-row" key={index}>
      <input aria-label={tr('Checkpoint 文件')+' '+(index+1)} aria-required="true" value={name} disabled={disabled} onChange={event=>update('checkpoint_files',rows.map((row,i)=>i===index?event.target.value:row))}/>
      {names.length>0&&<Button type="button"  aria-label={tr('移除文件')+' '+(index+1)} disabled={disabled} onClick={()=>update('checkpoint_files',names.filter((_,i)=>i!==index))}>{tr('移除文件')}</Button>}
     </div>)}
     <Button type="button"  disabled={disabled||rows.includes('')} onClick={()=>update('checkpoint_files',[...names,''])}>{tr('添加 checkpoint 文件')}</Button>
    </>}
   </fieldset>
   <p className="muted">{tr('续算源文件须位于原项目授权的路径。续算输入须保留原物理参数与状态。')}</p>
   {(fieldsByEngine.get(engine)||[]).map(({key,label})=>{
    const field=parameters[key];
    return <label className="resume-parameter-field" key={key}>
     {tr(label)}
     {field===undefined||typeof field==='string'&&!/[\r\n]/.test(field)?<input aria-required="true" disabled={disabled} value={field||''} onChange={event=>update(key,event.target.value)}/>:editAsJson}
    </label>;
   })}
  </>}
  <Disclosure className="resume-json" summary={<>{tr('高级 JSON 配置')}</>}>
   <textarea aria-label={tr('续算参数 JSON')} aria-invalid={!!error} className="json-input" disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>
  </Disclosure>
  {error&&<Notice compact severity="error" >{tr('续算参数 JSON')} · {tr(error)}</Notice>}
 </div>;
}
