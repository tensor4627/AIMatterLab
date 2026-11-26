import Button from '../../ui/Button';
import type {KeyboardEvent,ReactNode} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,PencilLine} from 'lucide-react';
import type {RpcEvent} from '../../../contracts/dto/agent';
import {t} from '../../ui/i18n';

type Choice={label:string;value:string;description?:string;recommended?:boolean};
export type ComposerQuestionItem={id:string;title:string;options:Choice[];freeform:boolean;secret:boolean;skippable:boolean};
type Answer={kind:'choice'|'text';value:string}|{kind:'skipped'};
export type QuestionProgress={index:number;highlight?:number;answers:Record<string,Answer>};
export const initialQuestionProgress:QuestionProgress={index:0,answers:{}};

export function composerQuestionItems(request:RpcEvent):ComposerQuestionItem[]{
 const params=request.params;
 if(request.method==='studio/question'&&Array.isArray(params?.questionOptions)&&params.questionOptions.length){
  const options=params.questionOptions.filter((option:any)=>typeof option.name==='string'&&typeof option.optionId==='string');
  return options.length?[{id:'acp',title:params.message||t('需要你的决定'),options:options.map((option:any)=>({label:option.name,value:option.optionId})),freeform:false,secret:false,skippable:true}]:[];
 }
 if(request.method!=='item/tool/requestUserInput'||!Array.isArray(params?.questions))return [];
 return params.questions.filter((question:any)=>typeof question?.id==='string').map((question:any)=>{
  const options:Choice[]=(Array.isArray(question.options)?question.options:[]).filter((option:any)=>typeof option?.label==='string'&&option.label.trim()).map((option:any)=>{
   const label=option.label.replace(/\s*(?:\(recommended\)|[（(]推荐[）)])$/i,'');
   return {label,value:option.label,description:option.description,recommended:label!==option.label||option.recommended===true};
  });
  return {id:question.id,title:question.question||question.header||t('需要你的决定'),options,freeform:!options.length||question.isOther===true,secret:question.isSecret===true,skippable:question.optional===true||question.canSkip===true||params.canSkip===true||params.isBlocking===false};
 });
}

type Props={request:RpcEvent;questions:ComposerQuestionItem[];progress:QuestionProgress;pending:boolean;active:boolean;stopControl?:ReactNode;onChange:(index:number,update:(current:QuestionProgress)=>QuestionProgress)=>void;onSubmit:(index:number,update?:(current:QuestionProgress)=>QuestionProgress)=>void};

export default function ComposerQuestion({request,questions,progress,pending,active,stopControl,onChange,onSubmit}:Props){
 const {index,answers}=progress,question=questions[index],{id,title,options,freeform,secret,skippable}=question;
 const draft=answers[id],savedOption=draft?.kind==='choice'?options.findIndex(option=>option.value===draft.value):-1;
 const highlight=progress.highlight??Math.max(savedOption,0),value=draft?.kind==='text'?draft.value:'';
 const focusInAgent=active&&(typeof document==='undefined'||document.activeElement===document.body||!!document.activeElement?.closest('.agent-panel'));
 const last=index===questions.length-1;
 const label=title;
 const updateAnswer=(next:Answer)=>(current:QuestionProgress)=>({...current,answers:{...current.answers,[id]:next}});
 const move=(by:number)=>onChange(index,current=>({...current,index:Math.max(0,Math.min(questions.length-1,index+by)),highlight:undefined}));
 const choose=(position:number)=>{const option=options[position];if(option)onSubmit(index,updateAnswer({kind:'choice',value:option.value}));};
 function keyboard(event:KeyboardEvent<HTMLElement>){
  if(pending||event.defaultPrevented||event.nativeEvent.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey)return;
  const target=event.target as HTMLElement,editing=target.tagName==='INPUT';
  if(editing){
   if(event.key==='Enter'&&!event.repeat){event.preventDefault();onSubmit(index);}
   return;
  }
  if(event.repeat&&!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
   if(questions.length>1){event.preventDefault();move(event.key==='ArrowRight'?1:-1);}
  }else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   if(!options.length)return;
   event.preventDefault();
   const next=highlight+(event.key==='ArrowDown'?1:-1);
   if(next===options.length&&freeform){event.currentTarget.querySelector('input')?.focus();return;}
   const clamped=Math.max(0,Math.min(next,options.length-1));
   onChange(index,current=>({...current,highlight:clamped}));
   event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice-index="${clamped}"]`)?.focus();
  }else if(/^[1-9]$/.test(event.key)){
   const position=Number(event.key)-1;
   if(options[position]){event.preventDefault();choose(position);}
   else if(position===options.length&&freeform){event.preventDefault();event.currentTarget.querySelector('input')?.focus();}
  }else if(event.key==='Enter'&&!(target.tagName==='BUTTON'&&target.dataset.choiceIndex===undefined)){
   if(options[highlight]){event.preventDefault();choose(highlight);}
  }
 }
 return <section className="agent-composer-question" role="group" aria-label={label} data-testid="agent-question-request" data-request-id={String(request.id)} data-request-turn-id={request.params?.turnId} aria-busy={pending} onKeyDown={keyboard}>
  <header className="agent-question-header">
   <strong data-testid="agent-question-title">{label}</strong>
   {(questions.length>1||stopControl)&&<div className="agent-question-navigation">
    {questions.length>1&&<>
     <Button variant="icon" size="sm" type="button" aria-label={t('上一题')}  data-testid="agent-question-previous" disabled={pending||index===0} onClick={()=>move(-1)}><ChevronLeft size={14}/></Button>
     <span data-testid="agent-question-count" aria-live="polite">{index+1} / {questions.length}</span>
     <Button variant="icon" size="sm" type="button" aria-label={t('下一题')}  data-testid="agent-question-next" disabled={pending||last} onClick={()=>move(1)}><ChevronRight size={14}/></Button>
    </>}
    {stopControl}
   </div>}
  </header>
  <div className="agent-question-body" key={id}>
   {options.length>0&&<div className="agent-question-options" role="radiogroup" aria-label={label}>
    {options.map((option,position)=><button type="button" className="agent-question-option" role="radio" aria-checked={savedOption===position} key={option.value}
      data-testid="agent-question-option" data-choice-index={position} data-highlighted={highlight===position} tabIndex={highlight===position?0:-1}
      autoFocus={focusInAgent&&highlight===position&&!value} disabled={pending} onFocus={()=>onChange(index,current=>({...current,highlight:position}))}
      onClick={event=>{if(event.detail<=1)choose(position);}}>
     <kbd className="agent-question-number" aria-hidden="true">{position+1}</kbd>
     <span className="agent-question-choice"><span className="agent-question-label"><strong>{option.label}</strong>{option.recommended&&<small>{t('推荐')}</small>}</span>{option.description&&<span className="agent-question-description">{option.description}</span>}</span>
     <ArrowRight size={14} className="agent-question-arrow" aria-hidden="true"/>
    </button>)}
   </div>}
  </div>
  {(freeform||pending||savedOption>=0||draft?.kind==='skipped'||skippable)&&<div className="agent-question-actions" key={`${id}:actions`}>
   {freeform&&<label className="agent-question-other">
    <PencilLine size={14} aria-hidden="true"/>
    <input data-testid="agent-question-input" aria-label={options.length?t('其他回答'):label} type={secret?'password':'text'} autoComplete="off"
      autoFocus={focusInAgent&&(!options.length||!!value||highlight<0)} placeholder={t(options.length?'其他回答':'输入自己的回答')} value={value} disabled={pending}
      onFocus={()=>onChange(index,current=>({...current,highlight:-1}))} onChange={event=>onChange(index,updateAnswer({kind:'text',value:event.target.value}))}/>
   </label>}
   {skippable&&!value.trim()&&<Button type="button"  data-testid="agent-question-skip" disabled={pending} onClick={()=>onSubmit(index,updateAnswer({kind:'skipped'}))}>{t('跳过')}</Button>}
   {(pending||value.trim()||savedOption>=0||draft?.kind==='skipped')&&<Button variant="primary" type="button" data-testid="agent-question-submit" disabled={pending} disabledReason={t('提交中…')} onClick={()=>onSubmit(index)}>{t(pending?'提交中…':last?'提交':'下一步')}</Button>}
  </div>}
  <span className="agent-question-sr" role="status">{t('等待你的回答')}</span>
 </section>;
}
