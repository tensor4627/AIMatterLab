import {tr} from './i18n';
import {useEffect,useRef,useState} from 'react';
import * as echarts from 'echarts';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import Editor,{loader} from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {invoke} from './types';

(self as any).MonacoEnvironment={getWorker:()=>new EditorWorker()};
loader.config({monaco});
export function CodeEditor({value,onChange,language='python',theme='dark',height='100%'}:{value:string;onChange:(v:string)=>void;language?:string;theme?:string;height?:string}){
 const [fontSize,setFontSize]=useState(Number(document.documentElement.style.getPropertyValue('--editor-font-size'))||13);
 useEffect(()=>{const update=()=>setFontSize(Number(document.documentElement.style.getPropertyValue('--editor-font-size'))||13);window.addEventListener('studio:appearance',update);return()=>window.removeEventListener('studio:appearance',update);},[]);
 return <Editor height={height} language={language} value={value} theme={theme==='dark'?'vs-dark':'light'}
  onChange={v=>onChange(v??'')} options={{fontSize,fontFamily:'Cascadia Code, Consolas, monospace',minimap:{enabled:false},padding:{top:16},scrollBeyondLastLine:false,automaticLayout:true,tabSize:4}}/>;
}
export function Chart({text,name}:{text:string;name:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!ref.current)return;
  const lines=text.split('\n').filter(x=>x.trim()&&!x.startsWith('#')).slice(0,4000);
  const rows=lines.map(x=>x.trim().split(/[,\s]+/).map(Number)).filter(r=>r.length>1&&r.every(Number.isFinite));
  const chart=echarts.init(ref.current);
  chart.setOption({backgroundColor:'transparent',color:['#a79aff','#5ccebe','#ecbe77','#7eafff'],
   textStyle:{color:'#aaaab9'},tooltip:{trigger:'axis'},legend:{top:8,textStyle:{color:'#aaaab9'},type:'scroll'},
   grid:{left:60,right:24,top:54,bottom:55},dataZoom:[{type:'inside'},{type:'slider',height:15,bottom:10}],
   xAxis:{type:'value',name:'column 0',splitLine:{lineStyle:{color:'#ffffff08'}}},
   yAxis:{type:'value',scale:true,splitLine:{lineStyle:{color:'#ffffff08'}}},
   series:rows[0]?.slice(1,7).map((_,i)=>({name:'column '+(i+1),type:'line',showSymbol:false,data:rows.map(r=>[r[0],r[i+1]])}))||[]});
  const observer=new ResizeObserver(()=>chart.resize());observer.observe(ref.current);
  return()=>{observer.disconnect();chart.dispose();};
 },[text,name]);
 return <div className="chart-wrap"><div className="chart-note">{name}{tr("· 原始列预览，单位以引擎输出定义为准")}</div><div ref={ref} className="chart"/></div>;
}
const elementColors:Record<string,number>={H:0xe2e2ed,C:0x8b8caa,N:0x7f9efa,O:0xea7b91,Li:0xb296f6,Si:0xd8b58c,P:0xe2af70,S:0xe8d276,Cl:0x79c8a2,Ga:0xaa9edc};
export function Structure({data}:{data:{positions:number[][];symbols:string[];cell:number[][];n_atoms:number}}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!ref.current)return;
  const host=ref.current,scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(45,1,.01,10000);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
  const geometry=new THREE.SphereGeometry(.38,12,10),material=new THREE.MeshStandardMaterial({roughness:.45,metalness:.08});
  const atoms=new THREE.InstancedMesh(geometry,material,data.positions.length);
  const center=new THREE.Vector3();
  data.positions.forEach(p=>center.add(new THREE.Vector3(...p)));center.divideScalar(Math.max(1,data.positions.length));
  let radius=1;
  const matrix=new THREE.Matrix4();
  data.positions.forEach((p,i)=>{
   const pos=new THREE.Vector3(...p).sub(center);radius=Math.max(radius,pos.length());
   matrix.makeTranslation(pos.x,pos.y,pos.z);atoms.setMatrixAt(i,matrix);
   atoms.setColorAt(i,new THREE.Color(elementColors[data.symbols[i]]??0xa7a7bb));
  });
  scene.add(atoms,new THREE.AmbientLight(0xffffff,2));
  const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(10,20,15);scene.add(light);
  camera.position.set(radius*1.5,radius,radius*2.6);camera.lookAt(0,0,0);
  const render=()=>renderer.render(scene,camera);
  controls.addEventListener('change',render);
  const resize=()=>{const{width,height}=host.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();render();};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  return()=>{observer.disconnect();controls.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();};
 },[data]);
 return <div className="structure-wrap"><div ref={ref} className="structure"/><div className="chart-note">{data.n_atoms}{tr("atoms · 保留原子顺序 · 拖动旋转，滚轮缩放")}</div></div>;
}
export function TerminalPanel({id}:{id:string|null}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!ref.current||!id)return;
  const terminal=new Terminal({fontSize:Number(document.documentElement.style.getPropertyValue('--terminal-font-size'))||12,fontFamily:'Cascadia Code, Consolas, monospace',theme:{background:'#121218',foreground:'#c8c8d4',cursor:'#a69af5'},convertEol:false});
  const fit=new FitAddon();terminal.loadAddon(fit);
  const appearance=()=>{terminal.options.fontSize=Number(document.documentElement.style.getPropertyValue('--terminal-font-size'))||12;fit.fit();};
  window.addEventListener('studio:appearance',appearance);
  terminal.open(ref.current);fit.fit();
  terminal.onData(data=>{void invoke('terminal.input',{id,data}).catch(()=>{});});
  const unsubscribe=window.studio?.onTerminal(e=>{if(e.id===id){if(e.data)terminal.write(e.data);if(e.closed)terminal.write('\r\n[terminal closed]\r\n');}});
  const observer=new ResizeObserver(()=>{fit.fit();void invoke('terminal.input',{id,cols:terminal.cols,rows:terminal.rows}).catch(()=>{});});
  observer.observe(ref.current);
  return()=>{unsubscribe?.();observer.disconnect();window.removeEventListener('studio:appearance',appearance);terminal.dispose();};
 },[id]);
 return <div ref={ref} className="terminal-surface">{!id&&<div className="muted">{tr("打开 WSL 或 SSH 终端，与计算工作区并排使用。")}</div>}</div>;
}
