import {useId} from 'react';
import {parameterDisplayLabel} from '../../ui/parameter-label.mjs';
import {t} from '../../ui/i18n';
import {workflowOutputLabels,type WorkflowFieldTarget} from './workflow-entry-summary.mjs';
import type {WorkflowRoadmap} from '../../../contracts/workflows/roadmap.mjs';
import './workflow-entry-summary.css';

export default function WorkflowEntrySummary({roadmap,missing,requirementCount,manualEdits,onField,onRequirements}:{roadmap?:WorkflowRoadmap;missing:WorkflowFieldTarget[];requirementCount:number;manualEdits?:Readonly<Record<string,number>>;onField:(stepId:string,key:string)=>void;onRequirements:()=>void}){
 const goals=workflowOutputLabels(roadmap),goalsId=useId();
 if(!goals.length&&!missing.length&&!requirementCount)return null;
 const missingLink=({step,field}:WorkflowFieldTarget)=><button type="button" className="button" title={t(step.title)} key={field.key} onClick={()=>onField(step.id,field.key)}>{t(parameterDisplayLabel(field,manualEdits))}</button>;
 return <div className="workflow-entry-summary" data-testid="workflow-entry-summary">
  {goals.length>0&&<div className="workflow-entry-row">
   <strong id={goalsId}>{t('目标产物')}</strong>
   <ul aria-labelledby={goalsId}>{goals.map(goal=><li key={goal.id}>{goal.label}{goal.inferred&&<small> · {t('待确认')}</small>}</li>)}</ul>
  </div>}
  {(missing.length>0||requirementCount>0)&&<div className="workflow-entry-row" role="group" aria-label={t('待补充')}>
   <strong>{t('待补充')}</strong>
   <div className="workflow-entry-links">
    {missing.slice(0,3).map(missingLink)}
    {missing.length>3&&<details><summary>{t('更多缺项')} · {missing.length-3}</summary><div className="workflow-entry-links">{missing.slice(3).map(missingLink)}</div></details>}
    {requirementCount>0&&<button type="button" className="button" onClick={onRequirements}>{t('待确认事项')} · {requirementCount}</button>}
   </div>
  </div>}
 </div>;
}
