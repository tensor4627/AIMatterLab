import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const IMAGE_LIMITS={axis:4096,outputPixels:16_000_000,devicePixels:64_000_000,pngBytes:32*1024*1024};
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function dimensions(width,height,limit=IMAGE_LIMITS.outputPixels){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>IMAGE_LIMITS.axis||height>IMAGE_LIMITS.axis||width*height>limit)throw Error('工作台图像尺寸超过诊断导出上限');}
export function inspectPng(bytes,decodePng){
 if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>IMAGE_LIMITS.pngBytes||!bytes.subarray(0,8).equals(signature)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw Error('工作台图像不是有效的有界 PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);dimensions(width,height);
 const decoded=decodePng(bytes);if(!decoded||decoded.isEmpty())throw Error('工作台 PNG 解码失败');const size=decoded.getSize(1);if(size.width!==width||size.height!==height)throw Error('工作台 PNG 尺寸核对失败');
 return {width,height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function writePngAtomically(destination,bytes,check,{filesystem=fs,uuid=randomUUID}={}){
 const temporary=path.join(path.dirname(destination),'.'+path.basename(destination)+'.partial-'+uuid());let descriptor,created=false,failure;
 try{check();descriptor=filesystem.openSync(temporary,'wx',0o600);created=true;filesystem.writeFileSync(descriptor,bytes);filesystem.fsyncSync(descriptor);filesystem.closeSync(descriptor);descriptor=undefined;check();filesystem.renameSync(temporary,destination);created=false;}
 catch(error){failure=error;throw error;}
 finally{const cleanup=[];if(descriptor!==undefined)try{filesystem.closeSync(descriptor);}catch(error){cleanup.push(error);}if(created)try{filesystem.unlinkSync(temporary);}catch(error){cleanup.push(error);}if(cleanup.length)throw new AggregateError(failure?[failure,...cleanup]:cleanup,'工作台图像临时文件清理失败');}
}
export function createWorkbenchImageExporter({ownerForEvent,displayScale,showSaveDialog,decodePng,write=writePngAtomically,timeoutMs=10_000,timers={set:setTimeout,clear:clearTimeout}}){
 const pending=new WeakSet();
 return async function save(data,event){
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length)throw Error('工作台图像请求必须为空');
  const owner=ownerForEvent(event);if(!owner)throw Error('工作台图像窗口身份不匹配');const contents=owner.webContents,frame=event.senderFrame,url=contents.getURL();
  if(pending.has(owner))throw Error('工作台图像正在导出');pending.add(owner);let invalid=false,timer;
  const invalidate=()=>{invalid=true;};
  const check=()=>{if(invalid||ownerForEvent(event)!==owner||owner.isDestroyed()||contents!==owner.webContents||contents.isDestroyed()||event.sender!==contents||event.senderFrame!==frame||frame?.parent||frame!==contents.mainFrame||frame?.url!==url||contents.getURL()!==url||!owner.isVisible()||owner.isMinimized())throw Error('工作台窗口已关闭、隐藏或变化，图像未保存');};
  owner.on('closed',invalidate);contents.on('destroyed',invalidate);contents.on('did-start-navigation',invalidate);
  try{
   const geometry=()=>{const [width,height]=owner.getContentSize(),scale=displayScale(owner),zoomFactor=contents.getZoomFactor();dimensions(width,height);if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(zoomFactor)||zoomFactor<=0||Math.ceil(width*scale)*Math.ceil(height*scale)>IMAGE_LIMITS.devicePixels)throw Error('工作台设备像素估算超过诊断导出上限');return {width,height,displayScale:scale,zoomFactor};};
   check();const before=geometry();const stableGeometry=()=>{const current=geometry();if(Object.keys(before).some(k=>current[k]!==before[k]))throw Error('工作台尺寸、DPI 或缩放已变化，请稳定窗口后重试');return current;};
   const timeout=new Promise((_,reject)=>{timer=timers.set(()=>{invalid=true;reject(Error('工作台图像采集超时；不会自动重试'));},timeoutMs);});
   const image=await Promise.race([Promise.resolve().then(()=>contents.capturePage(undefined,{stayHidden:true,stayAwake:false})),timeout]);timers.clear(timer);timer=undefined;check();
   const after=stableGeometry();if(!image||image.isEmpty())throw Error('工作台图像为空');const size=image.getSize(1);dimensions(size.width,size.height);if(size.width!==before.width||size.height!==before.height)throw Error('工作台返回的 1x 图像尺寸与客户区不符，未保存异常或不完整图像');const scales=image.getScaleFactors();if(!Array.isArray(scales)||!scales.length||scales.some(s=>!Number.isFinite(s)||s<=0||Math.ceil(size.width*s)*Math.ceil(size.height*s)>IMAGE_LIMITS.devicePixels))throw Error('工作台图像设备像素超过上限');
   const bytes=image.toPNG({scaleFactor:1}),metadata=inspectPng(bytes,decodePng);if(metadata.width!==size.width||metadata.height!==size.height)throw Error('工作台 PNG 与 NativeImage 的 1x 尺寸不符');check();stableGeometry();
   const response=await showSaveDialog(owner,{title:'保存当前工作台图像',defaultPath:'workbench-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png',filters:[{name:'PNG 图像',extensions:['png']}],properties:['showOverwriteConfirmation','dontAddToRecent']});
   check();if(response.canceled)return {status:'cancelled'};stableGeometry();const destination=response.filePath;if(typeof destination!=='string'||!path.isAbsolute(destination)||path.extname(destination).toLowerCase()!=='.png')throw Error('请选择 PNG 文件名');
   const commitCheck=()=>{check();stableGeometry();};commitCheck();write(destination,bytes,commitCheck);return {status:'saved',path:destination,...metadata,geometry:{before,after,nativeImage1xSize:size,availableScaleFactors:scales,requestedPngScaleFactor:1}};
  }finally{if(timer!==undefined)timers.clear(timer);owner.removeListener('closed',invalidate);contents.removeListener('destroyed',invalidate);contents.removeListener('did-start-navigation',invalidate);pending.delete(owner);}
 };
}
