import {lazy,Suspense} from 'react';
import {tr} from './i18n';

const CodeEditorImpl=lazy(()=>import('./heavy/code-editor'));
const ChartImpl=lazy(()=>import('./heavy/chart'));
const StructureImpl=lazy(()=>import('./heavy/structure'));

export function CodeEditor(props:{value:string;onChange:(v:string)=>void;language?:string;theme?:string;height?:string;readOnly?:boolean;onLineSelection?:(range:{firstLine:number;lastLine:number}|null)=>void}){
 return <Suspense fallback={<div className="muted" role="status">{tr('正在加载…')}</div>}><CodeEditorImpl {...props}/></Suspense>;
}
export function Chart(props:{text:string;name:string;viewKey?:string}){
 return <Suspense fallback={<div className="muted" role="status">{tr('正在加载…')}</div>}><ChartImpl {...props}/></Suspense>;
}
export function Structure(props:{data:{positions:number[][];symbols:string[];cell:number[][];n_atoms:number};viewKey?:string}){
 return <Suspense fallback={<div className="structure-wrap"><div className="muted" role="status">{tr('正在加载…')}</div></div>}><StructureImpl {...props}/></Suspense>;
}
