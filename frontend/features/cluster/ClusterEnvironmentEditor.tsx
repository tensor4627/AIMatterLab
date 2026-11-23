import {useState} from 'react';
import {t} from '../../ui/i18n';
import {editableEnvironmentSection,environmentSections,type ClusterEnvironmentDraft,type EnvironmentRowEdit,type EnvironmentSection} from './cluster-environment-draft';

const sectionLabels={
 executables:{title:'可执行文件',name:'可执行文件名称',value:'可执行文件绝对路径',add:'添加可执行文件'},
 repositories:{title:'代码仓库',name:'仓库标识',value:'仓库绝对路径',add:'添加仓库路径'},
 variables:{title:'环境变量',name:'变量名',value:'变量值',add:'添加环境变量'},
} as const;
const rawMessages={
 syntax:'JSON 语法有误。',object:'请填写 JSON 对象。',duplicate:'JSON 对象中有重复键。',number:'JSON 数值超出可保存的精度。',
} as const;
const rowMessages={name:'请填写条目名称。',duplicate:'同一组内的名称必须唯一。',integer:'请填写可保存的整数。'} as const;

export default function ClusterEnvironmentEditor({draft,disabled,onRow,onText}:{
 draft:ClusterEnvironmentDraft;disabled:boolean;onRow:(section:EnvironmentSection,edit:EnvironmentRowEdit)=>void;onText:(value:string)=>void;
}){
 const [advanced,setAdvanced]=useState(!!draft.rawIssue);
 return <div className="cluster-environment-editor" data-testid="cluster-environment-editor">
  <h3>{t('科学环境')}</h3>
  {draft.rawIssue&&<p className="notice" role="status">{t('修正高级 JSON 后可继续编辑表单。')}</p>}
  {environmentSections.map(section=>{
   const labels=sectionLabels[section],available=editableEnvironmentSection(draft,section);
   return <fieldset key={section} disabled={disabled||!!draft.rawIssue} data-testid={'cluster-environment-'+section}>
    <legend>{t(labels.title)}</legend>
    {!available?<p className="muted">{t('请在高级 JSON 中编辑此项。')}</p>:<>
     {draft.rows[section].map(row=>{
      const issue=draft.rowIssue?.section===section&&draft.rowIssue.id===row.id?draft.rowIssue:null;
      const cell=row.value;
      const nonAbsolute=section!=='variables'&&cell.kind==='text'&&!!(row.name||cell.text)&&(!cell.text.startsWith('/')||/[\n\0]/.test(cell.text));
      return <div className="cluster-environment-entry" key={row.id}>
       <label>{t(labels.name)}<input aria-invalid={issue?.field==='name'||undefined} value={row.name} onChange={event=>onRow(section,{type:'name',id:row.id,text:event.target.value})}/></label>
       {cell.kind==='json'?<span className="muted">{t('请在高级 JSON 中编辑此项。')}</span>:<label>{t(labels.value)}<input
        aria-invalid={issue?.field==='value'||nonAbsolute||undefined} inputMode={cell.kind==='integer'?'numeric':undefined}
        value={cell.text} onChange={event=>onRow(section,{type:'value',id:row.id,text:event.target.value})}/></label>}
       <button className="button" type="button" onClick={()=>onRow(section,{type:'remove',id:row.id})}>{t('删除条目')}</button>
       {(issue||nonAbsolute)&&<small className="cluster-environment-issue" role="status">{t(issue?rowMessages[issue.code]:'远程环境路径应为绝对路径。')}</small>}
      </div>;
     })}
     <button type="button" className="button" onClick={()=>onRow(section,{type:'add'})}>{t(labels.add)}</button>
    </>}
   </fieldset>;
  })}
  <details open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)} data-testid="cluster-environment-json">
   <summary>{t('高级 JSON 配置')}</summary>
   {draft.rawIssue&&<p className="notice" role="alert">{t(rawMessages[draft.rawIssue])}</p>}
   {draft.rowIssue&&<p className="notice" role="status">{t('修正表单中的字段后可以编辑 JSON。')}</p>}
   <label>{t('显式科学环境 · JSON')}<textarea rows={8} className="parameter-json" spellCheck={false} value={draft.text}
    aria-invalid={!!draft.rawIssue} readOnly={disabled||!!draft.rowIssue} onChange={event=>onText(event.target.value)}/></label>
  </details>
 </div>;
}
