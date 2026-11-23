import Tooltip from '../Tooltip';
import {tr} from '../i18n';
import {useEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {viewStateCache} from './view-state';
import './visualization.css';

type StructureData={positions:number[][];symbols:string[];cell:number[][];n_atoms:number};
type View={position:number[];target:number[];up:number[]};
type Elements=Map<string,{color:THREE.Color;count:number}>;
const views=viewStateCache<View>();
const elementColors=new Map(Object.entries({H:0xe2e2ed,C:0x8b8caa,N:0x7f9efa,O:0xea7b91,Li:0xb296f6,Na:0xab7bf1,Mg:0x90cf72,Al:0xbabed0,Si:0xd8b58c,P:0xe2af70,S:0xe8d276,Cl:0x79c8a2,K:0x9873e0,Ca:0x70c89b,Fe:0xd88058,Co:0xd995ac,Ni:0x66bc90,Cu:0xdd9b66,Zn:0x94b5c9,Ga:0xaa9edc,Ag:0xc2cbd4,Au:0xf1ce69}).map(([symbol,hex])=>[symbol,new THREE.Color(hex)]));
function colorFor(symbol:string){const known=elementColors.get(symbol);if(known)return known;let hash=0;for(const c of symbol)hash=hash*31+c.charCodeAt(0);return new THREE.Color().setHSL(((hash*137.508)%360)/360,.55,.65);}
const missingColor=colorFor('?');
const cellColor=()=>document.documentElement.dataset.theme==='light'?0x4d4268:0xaeb2cf;
function frameElements(symbols:string[]){
 const elements:Elements=new Map();
 for(const symbol of symbols){
  const element=elements.get(symbol);
  if(element)element.count++;
  else elements.set(symbol,{color:colorFor(symbol),count:1});
 }
 return elements;
}
function cellEdges(cell:number[][],center:THREE.Vector3){
 if(cell?.length!==3||cell.some(row=>row.length!==3||row.some(v=>!Number.isFinite(v))))return [];
 const [a,b,c]=cell.map(row=>new THREE.Vector3(...row));
 const corners=Array.from({length:8},(_,i)=>a.clone().multiplyScalar(i&1).addScaledVector(b,(i>>1)&1).addScaledVector(c,(i>>2)&1).sub(center));
 return corners.flatMap((corner,i)=>[1,2,4].filter(bit=>!(i&bit)).flatMap(bit=>[corner,corners[i|bit]]));
}
function Structure({data,viewKey}:{data:StructureData;viewKey?:string}){
 const ref=useRef<HTMLDivElement>(null),runtime=useRef<{update:(data:StructureData,elements:Elements)=>void;reset:()=>void}|null>(null);
 const elements=useMemo(()=>frameElements(data.symbols),[data.symbols]);
 useEffect(()=>{
  if(!ref.current)return;
  const host=ref.current,scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(45,1,.01,10000),controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=false;
  const geometry=new THREE.SphereGeometry(.38,12,10),material=new THREE.MeshStandardMaterial({roughness:.45,metalness:.08}),cellMaterial=new THREE.LineBasicMaterial({color:cellColor(),transparent:true,opacity:.9});
  const center=new THREE.Vector3(),position=new THREE.Vector3(),matrix=new THREE.Matrix4();
  let atoms:THREE.InstancedMesh|undefined,cell:THREE.LineSegments|undefined,radius=1,initialized=false;
  scene.add(new THREE.AmbientLight(0xffffff,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(10,20,15);scene.add(light);
  const render=()=>renderer.render(scene,camera);
  const updateAppearance=()=>{
   const color=cellColor();
   if(cellMaterial.color.getHex()===color)return;
   cellMaterial.color.setHex(color);
   if(cell)render();
  };
  window.addEventListener('studio:appearance',updateAppearance);
  const remember=()=>views.set(viewKey,{position:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray()});
  const reset=()=>{controls.target.set(0,0,0);camera.up.set(0,1,0);camera.position.set(radius*1.5,radius,radius*2.6);camera.lookAt(controls.target);controls.update();remember();render();};
  const change=()=>{remember();render();};controls.addEventListener('change',change);
  const update=(next:StructureData,frame:Elements)=>{
   if(!atoms||atoms.count!==next.positions.length){if(atoms){scene.remove(atoms);atoms.dispose();}atoms=new THREE.InstancedMesh(geometry,material,next.positions.length);scene.add(atoms);}
   center.set(0,0,0);
   for(const p of next.positions)center.add(position.set(p[0]??0,p[1]??0,p[2]??0));
   center.divideScalar(Math.max(1,next.positions.length));radius=1;
   for(let i=0;i<next.positions.length;i++){
    const p=next.positions[i];
    position.set(p[0]??0,p[1]??0,p[2]??0).sub(center);
    radius=Math.max(radius,position.length()+.38);
    atoms.setMatrixAt(i,matrix.makeTranslation(position.x,position.y,position.z));
    atoms.setColorAt(i,frame.get(next.symbols[i]||'?')?.color??missingColor);
   }
   atoms.instanceMatrix.needsUpdate=true;if(atoms.instanceColor)atoms.instanceColor.needsUpdate=true;atoms.computeBoundingSphere();
   if(cell){scene.remove(cell);cell.geometry.dispose();cell=undefined;}
   const edges=cellEdges(next.cell,center);if(edges.length){for(const p of edges)radius=Math.max(radius,p.length());cell=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges),cellMaterial);scene.add(cell);}
   camera.near=Math.max(.001,radius/10000);camera.far=Math.max(10000,radius*100);camera.updateProjectionMatrix();
   if(!initialized){initialized=true;const saved=views.get(viewKey);if(saved){camera.position.fromArray(saved.position);camera.up.fromArray(saved.up);controls.target.fromArray(saved.target);camera.lookAt(controls.target);controls.update();}else reset();}
   render();
  };
  runtime.current={update,reset};
  const resize=()=>{const{width,height}=host.getBoundingClientRect();renderer.setSize(Math.max(1,width),Math.max(1,height));camera.aspect=Math.max(1,width)/Math.max(1,height);camera.updateProjectionMatrix();render();};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  return()=>{if(initialized)remember();runtime.current=null;window.removeEventListener('studio:appearance',updateAppearance);observer.disconnect();controls.dispose();atoms?.dispose();cell?.geometry.dispose();geometry.dispose();material.dispose();cellMaterial.dispose();renderer.dispose();renderer.domElement.remove();};
 },[viewKey]);
 useEffect(()=>runtime.current?.update(data,elements),[data,elements,viewKey]);
 return <div className="structure-wrap"><div ref={ref} className="structure" role="img" aria-label={tr('结构预览')}/><div className="structure-toolbar"><div className="structure-legend" aria-label={tr('元素图例')}>{[...elements].map(([symbol,{color,count}])=><span key={symbol}><i style={{background:'#'+color.getHexString()}}/>{symbol} · {count}</span>)}</div><button className="button" type="button" onClick={()=>runtime.current?.reset()}>{tr('重置视角')}</button></div><div className="chart-note"><Tooltip content={tr('保留原子顺序。拖动旋转，滚轮缩放。')}>{tr('原子数')} · {data.n_atoms}</Tooltip></div></div>;
}
export default Structure;
