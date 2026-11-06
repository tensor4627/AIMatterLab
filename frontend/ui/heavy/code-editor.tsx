import {pixelFontSize} from "../ui-font.mjs";
import {useEffect,useRef} from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

(self as any).MonacoEnvironment={getWorker:()=>new EditorWorker()};
// Monaco cancels background tokenization when its model is disposed on tab changes.
// Treat that exact cancellation as expected; all other async failures remain visible.
window.addEventListener('unhandledrejection',event=>{const e=event.reason;if(e instanceof Error&&e.name==='Canceled'&&e.message==='Canceled')event.preventDefault();});
function CodeEditor({value,onChange,language='python',theme='dark',height='100%',readOnly=false}:{value:string;onChange:(v:string)=>void;language?:string;theme?:string;height?:string;readOnly?:boolean}){
 const host=useRef<HTMLDivElement>(null),editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null),changed=useRef(onChange);changed.current=onChange;
 useEffect(()=>{
  if(!host.current)return;
  const instance=monaco.editor.create(host.current,{value,language,theme:theme==='dark'?'vs-dark':'vs',fontSize:pixelFontSize(Number(document.documentElement.style.getPropertyValue('--editor-font-size'))||13,parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||12),fontFamily:'Cascadia Code, Consolas, monospace',minimap:{enabled:false},padding:{top:16},scrollBeyondLastLine:false,automaticLayout:true,tabSize:4,readOnly});editor.current=instance;
  const subscription=instance.onDidChangeModelContent(()=>changed.current(instance.getValue()));
  const appearance=()=>instance.updateOptions({fontSize:pixelFontSize(Number(document.documentElement.style.getPropertyValue('--editor-font-size'))||13,parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||12)});window.addEventListener('studio:appearance',appearance);
  return()=>{window.removeEventListener('studio:appearance',appearance);subscription.dispose();const model=instance.getModel();instance.dispose();model?.dispose();editor.current=null;};
 },[]);
 useEffect(()=>{if(editor.current&&editor.current.getValue()!==value)editor.current.setValue(value);},[value]);
 useEffect(()=>{const model=editor.current?.getModel();if(model)monaco.editor.setModelLanguage(model,language);editor.current?.updateOptions({readOnly});monaco.editor.setTheme(theme==='dark'?'vs-dark':'vs');},[language,readOnly,theme]);
 return <div ref={host} style={{height,width:'100%',minHeight:0}}/>;
}
export default CodeEditor;
