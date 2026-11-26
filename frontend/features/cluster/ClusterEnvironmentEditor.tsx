import Notice from '../../ui/Notice';
import Button from '../../ui/Button';
import Disclosure from '../../ui/Disclosure';
import Field from '../../ui/Field';
import {useId,useState} from 'react';
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
 const rowIssuePrefix=useId();
 return <div className="cluster-environment-editor" data-testid="cluster-environment-editor">
  <h3>{t('科学环境')}</h3>
  {draft.rawIssue&&<Notice compact  >{t('修正高级 JSON 后可继续编辑表单。')}</Notice>}
  {environmentSections.map(section=>{
   const labels=sectionLabels[section],available=editableEnvironmentSection(draft,section);
   return <fieldset key={section} disabled={disabled||!!draft.rawIssue} data-testid={'cluster-environment-'+section}>
    <legend>{t(labels.title)}</legend>
    {!available?<p className="muted">{t('请在高级 JSON 中编辑此项。')}</p>:<>
     {draft.rows[section].map(row=>{
      const issue=draft.rowIssue?.section===section&&draft.rowIssue.id===row.id?draft.rowIssue:null;
      const cell=row.value;
      const nonAbsolute=section!=='variables'&&cell.kind==='text'&&!!(row.name||cell.text)&&(!cell.text.startsWith('/')||/[\n\0]/.test(cell.text));
      const issueId=`${rowIssuePrefix}-${section}-${row.id}`;
      const pathIssueId=nonAbsolute&&issue?.field!=='value'?`${issueId}-path`:undefined;
      return <div className="cluster-environment-entry" key={row.id}>
       <label>{t(labels.name)}<input aria-invalid={issue?.field==='name'||undefined} aria-describedby={issue?.field==='name'?issueId:undefined} value={row.name} onChange={event=>onRow(section,{type:'name',id:row.id,text:event.target.value})}/></label>
       {cell.kind==='json'?<span className="muted">{t('请在高级 JSON 中编辑此项。')}</span>:<label>{t(labels.value)}<input
        aria-invalid={issue?.field==='value'||nonAbsolute||undefined} inputMode={cell.kind==='integer'?'numeric':undefined}
        aria-describedby={issue?.field==='value'?issueId:pathIssueId}
        value={cell.text} onChange={event=>onRow(section,{type:'value',id:row.id,text:event.target.value})}/></label>}
       <Button  type="button" onClick={()=>onRow(section,{type:'remove',id:row.id})}>{t('删除条目')}</Button>
       {issue&&<small className="cluster-environment-issue" id={issueId} role="status">{t(rowMessages[issue.code])}</small>}
       {pathIssueId&&<small className="cluster-environment-issue" id={pathIssueId} role="status">{t('远程环境路径应为绝对路径。')}</small>}
      </div>;
     })}
     <Button type="button"  onClick={()=>onRow(section,{type:'add'})}>{t(labels.add)}</Button>
    </>}
   </fieldset>;
  })}
  <Disclosure variant="section" open={advanced} forceOpen={!!draft.rawIssue} onToggle={event=>setAdvanced(event.currentTarget.open)} data-testid="cluster-environment-json" summary={t('高级 JSON 配置')}>
   {draft.rowIssue&&<Notice compact  >{t('修正表单中的字段后可以编辑 JSON。')}</Notice>}
   <Field label={t('显式科学环境 · JSON')} error={draft.rawIssue&&<span role="alert">{t(rawMessages[draft.rawIssue])}</span>}>
    {control=><textarea {...control} rows={8} className="parameter-json" spellCheck={false} value={draft.text}
     readOnly={disabled||!!draft.rowIssue} onChange={event=>onText(event.target.value)}/>}
   </Field>
  </Disclosure>
 </div>;
}
