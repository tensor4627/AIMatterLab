import {tr} from '../i18n';
import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const elementColors:Record<string,number>={H:0xe2e2ed,C:0x8b8caa,N:0x7f9efa,O:0xea7b91,Li:0xb296f6,Si:0xd8b58c,P:0xe2af70,S:0xe8d276,Cl:0x79c8a2,Ga:0xaa9edc};
function Structure({data}:{data:{positions:number[][];symbols:string[];cell:number[][];n_atoms:number}}){
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
export default Structure;
