import {useEffect,useRef,useState} from 'react';import {readLocalReviewStatus} from "../../api/local-review-client";import {type LocalReviewStatus} from '../../../contracts/dto/local-review';
export type LocalReviewRead={scope:string;phase:'inapplicable'|'offline'|'checking'|'resolved'|'error';value:LocalReviewStatus|null;error?:string};
export function useLocalReviewStatus(task:any,worker:boolean,nonce=0){
 const applicable=task.workflowVersion===2&&['pygas.build','bias.validate','gpumd.sampling'].includes(task.parameters?.engine),scope=JSON.stringify([task.id,task.provider,task.threadId,task.parameterRevision,task.updatedAt,task.workflowVersion,task.parameters?.engine,worker,nonce]);
 const [state,setState]=useState<LocalReviewRead|null>(null),seq=useRef(0),owner=useRef(scope);if(owner.current!==scope){owner.current=scope;seq.current++;}
 useEffect(()=>{const ticket=++seq.current;if(!worker||!applicable)return;const owns=()=>seq.current===ticket&&owner.current===scope;setState({scope,phase:'checking',value:null});void readLocalReviewStatus({taskId:task.id}).then(result=>{if(!owns())return;if(result.taskId!==task.id||result.parameterRevision!==task.parameterRevision||result.provider!==task.provider||result.threadId!==task.threadId||result.scope!=='local'||!['current','stale','not_run'].includes(result.status))throw Error('人工输入复核响应与当前流程不匹配');setState({scope,phase:'resolved',value:result});}).catch(error=>{if(owns())setState({scope,phase:'error',value:null,error:error instanceof Error?error.message:String(error)});});return()=>{seq.current++;};},[scope]);
 if(!applicable)return {scope,phase:'inapplicable',value:null} as LocalReviewRead;if(!worker)return {scope,phase:'offline',value:null} as LocalReviewRead;return state?.scope===scope?state:{scope,phase:'checking',value:null} as LocalReviewRead;
}
export function currentLocalReview(task:any,read:LocalReviewRead){const value=read.phase==='resolved'?read.value:null;return !!value&&value.status==='current'&&value.scope==='local'&&value.authority?.kind==='local-human'&&value.taskId===task.id&&value.provider===task.provider&&value.threadId===task.threadId&&value.parameterRevision===task.parameterRevision;}
export function localReviewNotice(task:any,read:LocalReviewRead,processing=false){
 if(read.phase==='inapplicable')return null;
 if(read.phase==='error')return {role:'alert' as const,message:'无法核对当前人工输入复核状态',error:read.error};
 if(read.phase==='offline')return {role:'status' as const,message:'尚未连接，无法核对人工输入复核状态'};
 if(read.phase==='checking')return {role:'status' as const,message:'正在核对当前人工输入复核状态…'};
 if(currentLocalReview(task,read))return null;
 const recorded=['validating','submitting','unknown'].includes(task.execution?.phase)||['queued','running','unknown'].includes(task.execution?.status);
 return recorded?{role:'status' as const,message:'进一步操作所需的复核状态尚未确认；请核对原作业状态，勿重新提交。'}:processing?{role:'status' as const,message:'正在处理当前操作；复核状态尚未确认，请等待并核对原任务记录。'}:{role:'alert' as const,message:'请先完成当前科学流程的参数复核。'};
}
