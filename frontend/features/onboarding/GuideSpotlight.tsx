import {useId,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {languageText} from '../../ui/i18n';
import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import {guideStep,type GuideStep} from './guide-steps';
import './setup-lesson.css';

type Box = {left:number; top:number; right:number; bottom:number};
type Side = 'right'|'left'|'bottom'|'top';
type Placement = {left:number; top:number; side?:Side; caret?:number};
type Spotlight = {area:Box; box:Box|null; target:HTMLElement|null; modal:HTMLElement|null; modalTitle:Box|null; modalClose:Box|null};

const margin=10, gap=14, caretSize=8;
const modalSelector='dialog:modal,[role="dialog"][aria-modal="true"]';
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const width=(box:Box)=>box.right-box.left;
const height=(box:Box)=>box.bottom-box.top;
function intersection(a:Box,b:Box):Box {
  return {left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)};
}
function overlapArea(a:Box,b:Box|null):number {
  if(!b)return 0;
  const overlap=intersection(a,b);
  return Math.max(0,width(overlap))*Math.max(0,height(overlap));
}

function isVisible(element:HTMLElement) {
  return !element.closest('[hidden],[inert]')&&element.checkVisibility({visibilityProperty:true})&&element.getClientRects().length>0;
}

function topModal() {
  const dialogs=[...document.querySelectorAll<HTMLElement>(modalSelector)].filter(isVisible).reverse();
  return dialogs.find(dialog=>dialog.matches('dialog:modal'))??dialogs[0]??null;
}

// Scroll panes and closed disclosures can hide an element whose bounds are in the viewport.
function visibleBox(target:HTMLElement,area:Box):Box|null {
  if(target.matches(':disabled,[aria-disabled="true"]')||!isVisible(target)||!target.checkVisibility({opacityProperty:true}))return null;
  const bounds=target.getBoundingClientRect();
  const minWidth=Math.min(12,bounds.width),minHeight=Math.min(12,bounds.height);
  let box=intersection(bounds,area);
  if(width(box)<minWidth||height(box)<minHeight)return null;
  for(let parent=target.parentElement;parent;parent=parent.parentElement){
    if(parent.matches('details:not([open])')&&!parent.querySelector(':scope > summary')?.contains(target))return null;
    const {overflowX,overflowY}=getComputedStyle(parent);
    if(overflowX==='visible'&&overflowY==='visible')continue;
    const outer=parent.getBoundingClientRect(),left=outer.left+parent.clientLeft,top=outer.top+parent.clientTop;
    if(overflowX!=='visible')box={...box,left:Math.max(box.left,left),right:Math.min(box.right,left+parent.clientWidth)};
    if(overflowY!=='visible')box={...box,top:Math.max(box.top,top),bottom:Math.min(box.bottom,top+parent.clientHeight)};
  }
  // Leave a clipped sliver or a control behind a sticky pane in the fallback state.
  if(width(box)<minWidth||height(box)<minHeight)return null;
  const receiver=document.elementsFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2)
    .find(element=>!element.closest('.guide-spotlight'));
  return receiver&&target.contains(receiver)?box:null;
}

function sameBox(a:Box|null,b:Box|null) {
  return a===b||!!a&&!!b&&a.left===b.left&&a.top===b.top&&a.right===b.right&&a.bottom===b.bottom;
}

function cardPlacement(card:HTMLElement,area:Box,{box:target,modalTitle:heading,modalClose:closeBounds}:Spotlight,docked:boolean):Placement|null {
  const w=card.offsetWidth,h=card.offsetHeight;
  const right=area.right-w,bottom=area.bottom-h;
  const ax=(area.left+area.right)/2,ay=(area.top+area.bottom)/2;
  const tx=target?(target.left+target.right)/2:ax,ty=target?(target.top+target.bottom)/2:ay;
  const above=[{left:right,top:area.top,side:'top' as const},{left:area.left,top:area.top,side:'top' as const}];
  const below=[{left:right,top:bottom,side:'bottom' as const},{left:area.left,top:bottom,side:'bottom' as const}];
  const candidates:{left:number;top:number;side:Side}[]=docked||!target?(target?[...above,...below]:[...below,...above]):[
    {left:target.right+gap,top:ty-h/2,side:'right'},
    {left:target.left-gap-w,top:ty-h/2,side:'left'},
    {left:tx-w/2,top:target.bottom+gap,side:'bottom'},
    {left:tx-w/2,top:target.top-gap-h,side:'top'}
  ];
  if(docked&&heading&&closeBounds){
    const start=Math.min(heading.right,closeBounds.right)+gap;
    const end=Math.max(heading.left,closeBounds.left)-gap;
    if(end-start>=w)candidates.push({left:(start+end-w)/2,top:area.top,side:'top'});
  }
  const best=candidates.map(candidate=>{
    const left=clamp(candidate.left,area.left,right),top=clamp(candidate.top,area.top,bottom);
    const bounds={left,top,right:left+w,bottom:top+h};
    const overlap=overlapArea(bounds,target),closeOverlap=overlapArea(bounds,closeBounds);
    const separation=target?{right:left-target.right,left:target.left-left-w,bottom:top-target.bottom,top:target.top-top-h}[candidate.side]:0;
    return {...candidate,left,top,overlap,closeOverlap,covered:overlap+overlapArea(bounds,heading),
      hasCaret:separation>=caretSize,centerDistance:Math.hypot(left+w/2-ax,top+h/2-ay)};
  }).sort((a,b)=>a.closeOverlap-b.closeOverlap||(!docked?a.overlap-b.overlap:0)||a.covered-b.covered||
    Number(b.hasCaret)-Number(a.hasCaret)||a.centerDistance-b.centerDistance)[0];
  if(!docked&&(best.overlap>0||best.closeOverlap>0))return null;
  const {left,top,side}=best;
  if(!target)return {left,top};
  const across=side==='left'||side==='right';
  const caret=clamp(across?ty-top:tx-left,12,(across?h:w)-12);
  return best.hasCaret||docked?{left,top,side,caret}:{left,top};
}

type Props={step:GuideStep;english:boolean;shortCase?:string;onDismiss?:()=>void;returnFocus?:RefObject<HTMLButtonElement|null>;continueTargets?:readonly string[]};
export default function GuideSpotlight({step,english,shortCase,onDismiss,returnFocus,continueTargets}:Props){
  const content=useMemo(()=>guideStep(step,english,shortCase),[step,english,shortCase]);
  const titleId=useId(),hintId=useId();
  const layer=useRef<HTMLDivElement>(null),tip=useRef<HTMLElement>(null);
  const current=useRef<Spotlight|null>(null),modalOwner=useRef<HTMLElement|null>(null);
  const previousFocus=useRef<HTMLElement|null>(null),closed=useRef(false),dismissCallback=useRef(onDismiss);
  const [spot,setSpot]=useState<Spotlight|null>(null),[dismissed,setDismissed]=useState(false);
  dismissCallback.current=onDismiss;

  function dismiss(restoreFocus:boolean){
    if(closed.current)return;
    closed.current=true;
    if(restoreFocus){
      const target=current.current?.target;
      const focus=target?.querySelector<HTMLElement>('.xterm-helper-textarea, :scope > summary')||target;
      for(const candidate of [focus,previousFocus.current,returnFocus?.current,current.current?.modal]){
        if(!candidate?.isConnected||layer.current?.contains(candidate))continue;
        candidate.focus({preventScroll:true});
        if(document.activeElement===candidate)break;
      }
    }
    setDismissed(true);
    dismissCallback.current?.();
  }

  useLayoutEffect(()=>{
    if(dismissed)return;
    const modalStep=step==='account'||step==='wsl'||step==='choose-wsl'||step==='choose-ssh';
    let frame=0;
    let observed=new Set<HTMLElement>();
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    const sizes=new ResizeObserver(schedule);
    function update(){
      frame=0;
      const titlebar=document.querySelector<HTMLElement>('.titlebar');
      const viewport={left:0,top:Math.max(0,titlebar?.getBoundingClientRect().bottom??0),right:innerWidth,bottom:innerHeight};
      const modal=topModal();
      const area=modal?.matches('dialog:modal')?intersection(viewport,modal.getBoundingClientRect()):viewport;
      const header=modal?.querySelector(':scope > header');
      const heading=header?.querySelector<HTMLElement>(':scope > :is(h1,h2,h3)');
      const close=header?.querySelector<HTMLButtonElement>(':scope > button:not(:disabled)');
      const modalTitle=heading&&isVisible(heading)?heading.getBoundingClientRect():null;
      const modalClose=close&&isVisible(close)?close.getBoundingClientRect():null;
      const scope=modal??document.body;
      let target:HTMLElement|null=null,box:Box|null=null,hasAnchors=false;
      for(const {id} of content.targets){
        for(const element of scope.querySelectorAll<HTMLElement>(`[data-guide-target="${id}"]`)){
          if(element.closest(modalSelector)!==modal)continue;
          hasAnchors=true;
          box=visibleBox(element,area);
          if(box){target=element;break;}
        }
        if(target)break;
      }
      const owner=modalOwner.current;
      const belongs=modal?hasAnchors||owner===modal||modalStep&&!owner?.isConnected:!modalStep;
      const next=belongs&&width(area)>margin*2&&height(area)>margin*2?{area,box,target,modal,modalTitle,modalClose}:null;
      if(next?.modal)modalOwner.current=next.modal;
      const elements=new Set<HTMLElement>();
      if(titlebar)elements.add(titlebar);
      if(modal)elements.add(modal);
      if(heading)elements.add(heading);
      if(close)elements.add(close);
      for(let element=target;element;element=element.parentElement)elements.add(element);
      for(const element of observed)if(!elements.has(element))sizes.unobserve(element);
      for(const element of elements)if(!observed.has(element))sizes.observe(element);
      observed=elements;
      const before=current.current;
      if(before===next||before&&next&&before.target===next.target&&before.modal===next.modal&&sameBox(before.area,next.area)&&sameBox(before.box,next.box)&&
        sameBox(before.modalTitle,next.modalTitle)&&sameBox(before.modalClose,next.modalClose))return;
      current.current=next;
      setSpot(next);
    }
    function onClick(event:MouseEvent){
      const active=current.current;
      if(event.isTrusted&&active?.target&&active.modal===topModal()&&event.composedPath().includes(active.target)&&
        !continueTargets?.includes(active.target.dataset.guideTarget??''))dismiss(false);
    }
    function onKeyDown(event:KeyboardEvent){
      const active=current.current,focused=document.activeElement;
      if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||!active||active.modal!==topModal()||
        active.modal&&!active.modal.contains(focused)||document.querySelector('select:open,[popover]:popover-open'))return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(!focused||focused===document.body||!!layer.current?.contains(focused));
    }
    const changes=new MutationObserver(records=>{
      if(records.some(record=>!layer.current?.contains(record.target)))schedule();
    });
    changes.observe(document.documentElement,{subtree:true,childList:true,attributes:true,
      attributeFilter:['hidden','open','disabled','aria-disabled','aria-modal','inert','class','style','data-guide-target']});
    window.addEventListener('resize',schedule);
    window.addEventListener('click',onClick,true);
    window.addEventListener('keydown',onKeyDown,true);
    document.addEventListener('scroll',schedule,true);
    document.addEventListener('animationend',schedule,true);
    document.addEventListener('transitionend',schedule,true);
    update();
    return ()=>{
      cancelAnimationFrame(frame);sizes.disconnect();changes.disconnect();
      window.removeEventListener('resize',schedule);
      window.removeEventListener('click',onClick,true);
      window.removeEventListener('keydown',onKeyDown,true);
      document.removeEventListener('scroll',schedule,true);
      document.removeEventListener('animationend',schedule,true);
      document.removeEventListener('transitionend',schedule,true);
    };
  },[content,dismissed,step,returnFocus,continueTargets]);

  useLayoutEffect(()=>{
    const scene=layer.current,card=tip.current;
    if(!scene||!card||!spot)return;
    const alignment=spot,{area,box}=alignment;
    function align(){
      if(!scene||!card)return;
      const origin=scene.getBoundingClientRect();
      const safe={left:area.left+margin,top:area.top+margin,right:area.right-margin,bottom:area.bottom-margin};
      const hole=box??area;
      const lengths={
        'area-left':area.left-origin.left,'area-top':area.top-origin.top,'area-width':width(area),'area-height':height(area),
        'hole-left':hole.left-area.left,'hole-top':hole.top-area.top,'hole-right':hole.right-area.left,'hole-bottom':hole.bottom-area.top,
        'hole-width':width(hole),'hole-height':height(hole),'card-width':width(safe),'card-height':height(safe)
      };
      for(const [key,value] of Object.entries(lengths))scene.style.setProperty('--guide-'+key,value+'px');
      scene.dataset.docked=String(!box);
      let placement=cardPlacement(card,safe,alignment,!box);
      if(!placement){
        scene.dataset.docked='true';
        placement=cardPlacement(card,safe,alignment,true)!;
      }
      scene.style.setProperty('--guide-tip-left',placement.left-origin.left+'px');
      scene.style.setProperty('--guide-tip-top',placement.top-origin.top+'px');
      scene.style.setProperty('--guide-caret',(placement.caret??0)+'px');
      scene.dataset.side=placement.side??'';
      scene.dataset.ready='true';
    }
    const sizes=new ResizeObserver(align);
    sizes.observe(card);
    align();
    return ()=>sizes.disconnect();
  },[spot,content]);

  if(dismissed||!spot)return null;
  const active=content.targets.find(target=>target.id===spot.target?.dataset.guideTarget);
  return createPortal(<div ref={layer} className="guide-spotlight" data-testid="guide-spotlight" data-step={step}
    data-target={active?.id??''} data-modal={String(!!spot.modal)}>
    {spot.box&&<div className="guide-focus-area" aria-hidden="true">
      <div className="guide-shade top"/><div className="guide-shade right"/>
      <div className="guide-shade bottom"/><div className="guide-shade left"/>
      <div className="guide-focus-ring"/>
    </div>}
    <div className="guide-tip-position">
      <aside className="guide-focus-tip" ref={tip} aria-labelledby={titleId} aria-describedby={hintId}>
        <strong id={titleId}>{content.heading}</strong>
        <Button variant="icon" size="sm" aria-label={languageText(english,'关闭提示')}
          onFocus={event=>{previousFocus.current=event.relatedTarget instanceof HTMLElement?event.relatedTarget:null;}}
          onClick={()=>dismiss(true)}><X size={16} aria-hidden="true"/></Button>
        {active?<p id={hintId}>{active.hint}</p>:<Notice compact className="guide-focus-message" id={hintId}>
          {languageText(english,'目标暂不可见。展开相应区域或滚动到该控件后，即可看到高亮。')}
        </Notice>}
      </aside>
    </div>
  </div>,spot.modal??document.body);
}
