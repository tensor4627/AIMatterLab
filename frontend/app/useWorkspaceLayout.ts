import {useEffect,useState} from 'react';
import {readPreference,writePreference} from '../ui/preference-storage';
import {initialBottomExpanded} from './workspace-shell.mjs';

function useLayoutPreference<T extends number|boolean>(key:string, initial:()=>T) {
 const [value,setValue]=useState<T>(initial);
 useEffect(()=>{writePreference(key,String(value));},[key,value]);
 return [value,setValue] as const;
}

function useSize(key:string, fallback:number) {
 return useLayoutPreference(key,()=>{
  const value=Number(readPreference(key));
  return Number.isFinite(value)&&value>0 ? value : fallback;
 });
}

export function useWorkspaceLayout() {
 const [sidebarVisible,setSidebarVisible]=useLayoutPreference('studio.sidebarVisible',()=>readPreference('studio.sidebarVisible')!=='false');
 const [sidebarWidth,setSidebarWidth]=useSize('studio.sidebarWidth',240);
 const [agentVisible,setAgentVisible]=useLayoutPreference('studio.agent',()=>readPreference('studio.agent')!=='false');
 const [agentWidth,setAgentWidth]=useSize('studio.agentWidth',0);
 const [overviewAgentWidth,setOverviewAgentWidth]=useSize('studio.overviewAgentWidth',0);
 const [bottomHeight,setBottomHeight]=useSize('studio.bottom',190);
 const [bottomExpanded,setBottomExpanded]=useLayoutPreference('studio.bottomExpanded',()=>initialBottomExpanded(readPreference));
 const [windowWidth,setWindowWidth]=useState(()=>window.innerWidth);
 useEffect(()=>{
  const resize=()=>setWindowWidth(window.innerWidth);
  window.addEventListener('resize',resize);
  resize();
  return ()=>window.removeEventListener('resize',resize);
 },[]);
 return {sidebarVisible,setSidebarVisible,sidebarWidth,setSidebarWidth,agentVisible,setAgentVisible,
  agentWidth,setAgentWidth,overviewAgentWidth,setOverviewAgentWidth,bottomHeight,setBottomHeight,
  bottomExpanded,setBottomExpanded,windowWidth};
}
