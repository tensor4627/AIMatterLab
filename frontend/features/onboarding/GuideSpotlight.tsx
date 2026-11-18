import {useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {guideStep,type GuideStep} from './guide-steps';
import './setup-lesson.css';

type Box = {left:number; top:number; right:number; bottom:number};
const margin=10, gap=14;
const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(min,max),Math.max(min,value));

// A scrolling pane can clip a control even when the control is inside the window.
function visibleBox(target: HTMLElement): Box | null {
  const r=target.getBoundingClientRect();
  let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);
  let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
  for(let parent=target.parentElement;parent;parent=parent.parentElement){
    const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
    if(style.overflowX!=='visible'){
      const start=bounds.left+parent.clientLeft;
      left=Math.max(left,start);right=Math.min(right,start+parent.clientWidth);
    }
    if(style.overflowY!=='visible'){
      const start=bounds.top+parent.clientTop;
      top=Math.max(top,start);bottom=Math.min(bottom,start+parent.clientHeight);
    }
  }
  if(right<=left||bottom<=top)return null;
  return {left:Math.max(1,left-4),right:Math.min(innerWidth-1,right+4),
    top:Math.max(1,top-4),bottom:Math.min(innerHeight-1,bottom+4)};
}

function placeTip(card:HTMLElement,box:Box){
  const width=card.offsetWidth,height=card.offsetHeight;
  const centerX=(box.left+box.right-width)/2,centerY=(box.top+box.bottom-height)/2;
  let x=centerX,y=centerY;
  if(box.right+gap+width<=innerWidth-margin)x=box.right+gap;
  else if(box.left-gap-width>=margin)x=box.left-gap-width;
  else if(innerHeight-box.bottom>=height+gap+margin||innerHeight-box.bottom>=box.top)y=box.bottom+gap;
  else y=box.top-gap-height;
  card.style.left=clamp(x,margin,innerWidth-width-margin)+'px';
  card.style.top=clamp(y,margin,innerHeight-height-margin)+'px';
}

type Props={step:GuideStep;english:boolean;shortCase?:string;onDismiss?:()=>void};
export default function GuideSpotlight({step,english,shortCase,onDismiss}:Props){
  const content=useMemo(()=>guideStep(step,english,shortCase),[step,english,shortCase]);
  const dialog=useRef<HTMLDialogElement>(null),ring=useRef<HTMLDivElement>(null),card=useRef<HTMLElement>(null);
  const target=useRef<HTMLElement|null>(null),[activeId,setActiveId]=useState(''),[dismissed,setDismissed]=useState(false);
  const titleId=useId(),hintId=useId();
  function dismiss(){
    if(!dialog.current?.open)return;
    const element=target.current;
    dialog.current.close();
    setDismissed(true);
    onDismiss?.();
    if(element?.isConnected){
      const focus=element.querySelector<HTMLElement>('.xterm-helper-textarea')||element;
      focus.focus({preventScroll:true});
    }
  }
  useLayoutEffect(()=>{
    const layer=dialog.current,outline=ring.current,tip=card.current;
    if(dismissed||!layer||!outline||!tip)return;
    let frame=0;
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    const sizes=new ResizeObserver(schedule);
    function update(){
      frame=0;
      let found:HTMLElement|null=null;
      for(const {id} of content.targets){
        found=[...document.querySelectorAll<HTMLElement>(`[data-guide-target="${id}"]`)].find(el=>
          !el.matches(':disabled')&&!el.closest('[hidden],[inert]')&&el.checkVisibility({visibilityProperty:true})&&el.getClientRects().length
        )??null;
        if(found)break;
      }
      if(found!==target.current){
        if(target.current)sizes.unobserve(target.current);
        target.current=found;
        if(found){
          sizes.observe(found);
          found.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
          setActiveId(found.dataset.guideTarget!);
        }
      }
      const box=found&&visibleBox(found);
      if(!box){if(layer!.open)layer!.close();return;}
      if(!layer!.open)layer!.showModal();
      Object.assign(outline!.style,{left:box.left+'px',top:box.top+'px',width:box.right-box.left+'px',height:box.bottom-box.top+'px'});
      placeTip(tip!,box);
    }
    sizes.observe(tip);
    const changes=new MutationObserver(schedule);
    changes.observe(document.getElementById('root')||document.body,{subtree:true,childList:true,attributes:true,
      attributeFilter:['hidden','open','disabled','inert','class','style','data-guide-target']});
    window.addEventListener('resize',schedule);
    document.addEventListener('scroll',schedule,true);
    update();
    return ()=>{
      cancelAnimationFrame(frame);sizes.disconnect();changes.disconnect();
      window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);
      if(layer.open)layer.close();
      target.current=null;
    };
  },[content,dismissed]);

  if(dismissed)return null;
  return createPortal(<dialog ref={dialog} className="guide-spotlight" role="dialog" aria-modal="true"
    aria-labelledby={titleId} aria-describedby={hintId} data-testid="guide-spotlight" data-step={step} data-target={activeId}
    onClick={event=>{event.stopPropagation();dismiss();}} onCancel={event=>{event.preventDefault();dismiss();}}
    onKeyDown={event=>{
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();dismiss();}
      if(event.key==='Tab'){event.preventDefault();card.current?.querySelector('button')?.focus();}
    }}>
    <div ref={ring} className="guide-focus-ring" aria-hidden="true"/>
    <aside className="guide-focus-tip" ref={card}>
      <strong id={titleId}>{content.heading}</strong>
      <button type="button" aria-label={english?'Dismiss hint':'关闭提示'}><X size={16} aria-hidden="true"/></button>
      <p id={hintId}>{(content.targets.find(item=>item.id===activeId)||content.targets[0]).hint}</p>
      <small>{english?'Click anywhere to continue':'点击任意处继续'}</small>
    </aside>
  </dialog>,document.body);
}
