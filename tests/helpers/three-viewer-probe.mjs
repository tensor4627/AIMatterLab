import {InstancedMesh,Scene,Vector3} from 'three';

export function observeStructureViews(){
 const snapshots=new WeakMap(),original=Scene.prototype.onBeforeRender;
 const stable=values=>values.map(value=>Number(value.toFixed(9)));
 Scene.prototype.onBeforeRender=function(renderer,scene,camera,target){
  const atoms=scene.children.find(node=>node.isInstancedMesh),cell=scene.children.find(node=>node.isLineSegments);
  if(atoms)snapshots.set(renderer.domElement,{
   count:atoms.count,
   view:{position:stable(camera.position.toArray()),orientation:stable(camera.quaternion.toArray())},
   transforms:Array.from(atoms.instanceMatrix.array),cell:Array.from(cell?.geometry.getAttribute('position').array||[]),
   cellAppearance:cell?{color:cell.material.color.getHexString(),opacity:cell.material.opacity}:null,
  });
  return original.call(this,renderer,scene,camera,target);
 };
 return {read:canvas=>snapshots.get(canvas),restore(){delete Scene.prototype.onBeforeRender;}};
}

export function observeAtomUpdates(){
 const original={add:Vector3.prototype.add,sub:Vector3.prototype.sub,setColorAt:InstancedMesh.prototype.setColorAt};
 const sums=new Map(),offsets=new Map(),colors=new Set();
 function record(groups,key,value){
  let group=groups.get(key);
  if(!group){group={calls:0,objects:new Set()};groups.set(key,group);}
  group.calls++;
  group.objects.add(value);
 }
 Vector3.prototype.add=function(vector){record(sums,this,vector);return original.add.call(this,vector);};
 Vector3.prototype.sub=function(vector){record(offsets,vector,this);return original.sub.call(this,vector);};
 let atoms=0,lastCenter,lastVector;
 InstancedMesh.prototype.setColorAt=function(index,color){atoms++;colors.add(color);return original.setColorAt.call(this,index,color);};
 return {
  get count(){return atoms;},
  snapshot(expected){
   const [center,sum]=[...sums].find(([,group])=>group.calls===expected)||[];
   const shift=offsets.get(center);
   const vector=sum?.objects.values().next().value;
   const result={atoms,centerVectors:sum?.objects.size,offsetVectors:shift?.objects.size,offsets:shift?.calls,colorObjects:colors.size,
    sharedVector:shift?.objects.has(vector),reusedCenter:lastCenter===center,reusedVector:lastVector===vector};
   lastCenter=center;lastVector=vector;
   sums.clear();offsets.clear();colors.clear();atoms=0;
   return result;
  },
  restore(){Vector3.prototype.add=original.add;Vector3.prototype.sub=original.sub;InstancedMesh.prototype.setColorAt=original.setColorAt;}
 };
}
