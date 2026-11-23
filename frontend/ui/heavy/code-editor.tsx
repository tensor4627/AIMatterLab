import {pixelFontSize} from "../ui-font.mjs";
import {useEffect,useRef} from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

(self as any).MonacoEnvironment={getWorker:()=>new EditorWorker()};
// Monaco cancels background tokenization when its model is disposed on tab changes.
// Treat that exact cancellation as expected; all other async failures remain visible.
window.addEventListener('unhandledrejection',event=>{const e=event.reason;if(e instanceof Error&&e.name==='Canceled'&&e.message==='Canceled')event.preventDefault();});
const lightTheme='aimatterlab-light';
monaco.editor.defineTheme(lightTheme,{base:'vs',inherit:true,rules:[],colors:{
 'editor.background':'#F8F7FA','editor.foreground':'#292633','editorLineNumber.foreground':'#5B5868',
 'editorLineNumber.activeForeground':'#292633','editorCursor.foreground':'#443579',
 'editor.selectionBackground':'#CFC3F5','editor.inactiveSelectionBackground':'#E2D9F3','editor.lineHighlightBackground':'#EFEAF4',
}});
function editorTheme(theme?:string){return (theme??document.documentElement.dataset.theme)==='light'?lightTheme:'vs-dark';}
function editorFontSize(){
 const style=getComputedStyle(document.documentElement);
 return pixelFontSize(parseFloat(style.getPropertyValue('--editor-font-size'))||13,Math.max(12,parseFloat(style.getPropertyValue('--ui-min-font'))||12));
}
function CodeEditor({value,onChange,language='python',theme,height='100%',readOnly=false,onLineSelection}:{value:string;onChange:(v:string)=>void;language?:string;theme?:string;height?:string;readOnly?:boolean;onLineSelection?:(range:{firstLine:number;lastLine:number}|null)=>void}){
 const host=useRef<HTMLDivElement>(null),editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null),changed=useRef(onChange);changed.current=onChange;
 const lineSelection=useRef(onLineSelection);lineSelection.current=onLineSelection;
 const themeRef=useRef(theme);themeRef.current=theme;
 useEffect(()=>{
  if(!host.current)return;
  const instance=monaco.editor.create(host.current,{value,language,theme:editorTheme(themeRef.current),fontSize:editorFontSize(),fontFamily:'Cascadia Code, Consolas, monospace',minimap:{enabled:false},padding:{top:16},scrollBeyondLastLine:false,automaticLayout:true,tabSize:4,readOnly});editor.current=instance;
  const subscription=instance.onDidChangeModelContent(()=>changed.current(instance.getValue()));
  const selection=instance.onDidChangeCursorSelection(({selection})=>{
   const firstLine=selection.startLineNumber;
   const lastLine=Math.max(firstLine,selection.endLineNumber-(selection.endColumn===1?1:0));
   lineSelection.current?.(selection.isEmpty()?null:{firstLine,lastLine});
  });
  const appearance=()=>{instance.updateOptions({fontSize:editorFontSize()});monaco.editor.setTheme(editorTheme(themeRef.current));};
  window.addEventListener('studio:appearance',appearance);
  return()=>{window.removeEventListener('studio:appearance',appearance);subscription.dispose();selection.dispose();const model=instance.getModel();instance.dispose();model?.dispose();editor.current=null;};
 },[]);
 useEffect(()=>{if(editor.current&&editor.current.getValue()!==value)editor.current.setValue(value);},[value]);
 useEffect(()=>{const model=editor.current?.getModel();if(model)monaco.editor.setModelLanguage(model,language);editor.current?.updateOptions({readOnly});},[language,readOnly]);
 useEffect(()=>{monaco.editor.setTheme(editorTheme(theme));},[theme]);
 return <div ref={host} style={{height,width:'100%',minHeight:0}}/>;
}
export default CodeEditor;
