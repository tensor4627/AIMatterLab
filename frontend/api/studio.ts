import type {RpcEvent} from '../../contracts/dto/agent';

export interface Studio {invoke<T=any>(method:string,data?:unknown):Promise<T>;onEvent(callback:(event:RpcEvent)=>void):()=>void;onTerminal(callback:(event:{id:string;data?:string;closed?:boolean})=>void):()=>void}

declare global {interface Window {studio?:Studio}}

export async function invoke<T=any>(method:string,data?:unknown):Promise<T>{
  if(!window.studio) throw new Error('此页面是浏览器预览。请从 Electron 桌面应用连接计算环境。');
  return window.studio.invoke<T>(method,data);
}
