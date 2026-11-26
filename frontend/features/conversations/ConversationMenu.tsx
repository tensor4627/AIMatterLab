import Button from '../../ui/Button';
import {useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {Archive,ArchiveRestore,ArrowLeft,Check,ChevronRight,Folder,MoreHorizontal,Pencil,Pin,Trash2} from 'lucide-react';
import type {Conversation,ConversationGroup} from '../../../contracts/dto/agent';
import {t} from '../../ui/i18n';
import './conversation-menu.css';

type ConversationProps={
 conversation:Conversation;
 groups:{id:string;name:string}[];
 disabled?:boolean;
 deleting?:boolean;
 onRename:()=>void;
 onDelete:()=>void;
 onArchive?:()=>void;
 onOrganize:(pinned:boolean,groupId?:string|null)=>void;
};
type Props=ConversationProps|{group:ConversationGroup;disabled?:boolean;deleting?:boolean;onDelete:()=>void};

/** Render at the viewport level so sidebar scrolling cannot clip the action menu. */
export default function ConversationMenu(props:Props){
 const {disabled=false,deleting=false,onDelete}=props;
 const group='group' in props?props.group:null,conversation='conversation' in props?props.conversation:null;
 const onArchive='conversation' in props?props.onArchive:undefined;
 const groups='groups' in props?props.groups:[];
 const onRename=()=>{if('conversation' in props)props.onRename();};
 const onOrganize=(pinned:boolean,groupId?:string|null)=>{if('conversation' in props)props.onOrganize(pinned,groupId);};
 const [open,setOpen]=useState(false),[projects,setProjects]=useState(false);
 const [position,setPosition]=useState<{left:number;top:number;maxHeight:number}|null>(null);
 const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),lastFocus=useRef(false),focusMove=useRef(false),focusedView=useRef<boolean|null>(null);
 const menuId=useId(),label=t(group?'分组菜单':'会话菜单')+' · '+(group||conversation)!.name;

 function close(restoreFocus=false){setOpen(false);setProjects(false);setPosition(null);focusedView.current=null;if(restoreFocus)trigger.current?.focus();}
 function items(){return [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"],[role="menuitemradio"]')||[])].filter(item=>!item.disabled);}
 function showProjects(){lastFocus.current=false;setProjects(true);}
 function back(){focusMove.current=true;setProjects(false);}
 function act(action:()=>void){close(true);action();}

 useLayoutEffect(()=>{
  if(!open||!menu.current||!trigger.current)return;
  const anchor=trigger.current.getBoundingClientRect(),box=menu.current.getBoundingClientRect(),margin=8;
  const maxHeight=Math.max(0,window.innerHeight-margin*2);
  const height=Math.min(box.height,maxHeight),width=box.width;
  const below=anchor.bottom+6,above=anchor.top-height-6;
  const top=below+height<=window.innerHeight-margin?below:above>=margin?above:Math.max(margin,window.innerHeight-height-margin);
  setPosition({left:Math.max(margin,Math.min(anchor.right-width,window.innerWidth-width-margin)),top,maxHeight});
 },[open,projects,groups.length]);

 // The positioning commit must make the popup visible before the browser can focus it.
 useLayoutEffect(()=>{
  if(!open||!position||focusedView.current===projects)return;
  const focus=focusMove.current?menu.current?.querySelector<HTMLButtonElement>('[data-project-action]'):lastFocus.current?items().at(-1):items()[0];
  focus?.focus();focusedView.current=projects;focusMove.current=false;lastFocus.current=false;
 },[open,projects,position]);

 useEffect(()=>{if(disabled&&open)close(true);},[disabled,open]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!menu.current?.contains(target)&&!trigger.current?.contains(target))close();};
  const focusOutside=(event:FocusEvent)=>{const target=event.target as Node;if(!menu.current?.contains(target)&&!trigger.current?.contains(target))close();};
  const scroll=(event:Event)=>{if(!menu.current?.contains(event.target as Node))close(!!menu.current?.contains(document.activeElement));};
  const resize=()=>close(!!menu.current?.contains(document.activeElement));
  document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',focusOutside);
  document.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',focusOutside);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize);};
 },[open]);

 function keyDown(event:KeyboardEvent<HTMLDivElement>){
  const enabled=items(),index=enabled.indexOf(document.activeElement as HTMLButtonElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
  else if(event.key==='Tab'){close(true);}
  else if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[next]?.focus();
  }else if(event.key==='ArrowRight'&&!projects&&(event.target as HTMLElement).closest('[data-project-action]')){event.preventDefault();showProjects();}
  else if(event.key==='ArrowLeft'&&projects){event.preventDefault();back();}
 }

 return <>
  <Button variant="icon" size="sm" tooltip={t(group?'分组菜单':'会话菜单')} ref={trigger} className={'conversation-menu-trigger'+(group?' group-menu-trigger':'')} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} disabled={disabled} onClick={event=>{event.preventDefault();if(open)close(true);else{setProjects(false);setOpen(true);}}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();lastFocus.current=event.key==='ArrowUp';setProjects(false);setOpen(true);}}}><MoreHorizontal size={16} aria-hidden="true"/></Button>
  {open&&createPortal(<div ref={menu} id={menuId} className="conversation-popover" role="menu" aria-label={label} onKeyDown={keyDown} style={{left:position?.left??0,top:position?.top??0,maxHeight:position?.maxHeight??'calc(100vh - 16px)',visibility:position?'visible':'hidden'}}>
   {projects&&conversation?<>
    <button type="button" role="menuitem" tabIndex={-1} className="conversation-popover-back" onClick={back}><ArrowLeft size={16}/><span>{t('移动到分组')}</span></button>
    <div role="separator" className="conversation-popover-separator"/>
    {[{id:'',name:t('未分组会话')},...groups].map(group=><button type="button" role="menuitemradio" aria-checked={(conversation.groupId||'')===group.id} tabIndex={-1} key={group.id} disabled={disabled} onClick={()=>act(()=>onOrganize(!!conversation.pinned,group.id||null))}><Folder size={16}/><span title={group.name}>{group.name}</span>{(conversation.groupId||'')===group.id&&<Check size={15} className="conversation-popover-check"/>}</button>)}
   </>:group?<button type="button" role="menuitem" tabIndex={-1} disabled={disabled||deleting} className="conversation-delete" aria-label={t('删除分组')+' · '+group.name} onClick={()=>act(onDelete)}><Trash2 size={16}/><span>{t('删除分组')}</span></button>:conversation&&<>
    <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} aria-label={t('重命名会话')+' · '+conversation.name} onClick={()=>act(onRename)}><Pencil size={16}/><span>{t('重命名')}</span></button>
    <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} onClick={()=>act(()=>onOrganize(!conversation.pinned))}><Pin size={16}/><span>{t(conversation.pinned?'取消置顶':'置顶')}</span></button>
    <button type="button" role="menuitem" tabIndex={-1} data-project-action aria-haspopup="menu" disabled={disabled} aria-label={t('移动会话到分组')+' · '+conversation.name} onClick={showProjects}><Folder size={16}/><span>{t('移动到分组')}</span><ChevronRight size={15}/></button>
    {onArchive&&<button type="button" role="menuitem" tabIndex={-1} disabled={deleting} onClick={()=>act(onArchive)}>{conversation.archived?<ArchiveRestore size={16}/>:<Archive size={16}/>}<span>{t(conversation.archived?'恢复归档会话':'归档会话')}</span></button>}
    <div role="separator" className="conversation-popover-separator"/>
    <button type="button" role="menuitem" tabIndex={-1} disabled={disabled||deleting} className="conversation-delete" aria-label={t('删除对话')+' · '+conversation.name} onClick={()=>act(onDelete)}><Trash2 size={16}/><span>{t('删除对话')}</span></button>
   </>}
  </div>,document.body)}
 </>;
}
