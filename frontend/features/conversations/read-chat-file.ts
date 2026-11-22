import {attachmentLimits,chatImageMime} from '../../../contracts/agent/chat-attachments.mjs';
import type {SelectedChatFile} from '../../../contracts/dto/chat-attachments';
import {ChatFileReadError,checkedText,decodeUnicode} from './chat-file-text';

const officeFormats={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'} as const;
const officeExtensions=new Set(Object.keys(officeFormats));
const imageExtensions=new Set(['png','jpg','jpeg','webp','gif']);
const pdfSignature='%PDF-';

export async function readChatFile(file:File):Promise<SelectedChatFile>{
 const {name,size}=file,extension=name.split('.').at(-1)?.toLowerCase()??'';
 if(!size)throw new ChatFileReadError(name+' 是空文件。');
 if(size>attachmentLimits.documentBytes)throw new ChatFileReadError(name+' 超过 20 MiB。请选择较小的文件。');
 const source=new Uint8Array(await file.arrayBuffer()),image=chatImageMime(source);
 if(image){
  if(size>attachmentLimits.imageBytes)throw new ChatFileReadError(name+' 超过单张图片的 8 MiB 上限。');
  try{
   const thumbnail=await createImageBitmap(new Blob([file],{type:image}),{resizeWidth:1,resizeHeight:1});
   thumbnail.close();
  }catch{throw new ChatFileReadError(name+' 的图片内容无法解码，请重新导出图片。');}
  return {name,size,bytes:source,mimeType:image};
 }
 if(imageExtensions.has(extension)||file.type.startsWith('image/')&&file.type!=='image/svg+xml')throw new ChatFileReadError(name+' 需要是有效的 PNG、JPEG、WebP 或 GIF 图片。');
 if(extension==='pdf'||file.type==='application/pdf'||String.fromCharCode(...source.subarray(0,5))===pdfSignature){
  const {readPdfText}=await import('./read-pdf-text');
  const text=await readPdfText(source);
  return {name,size,text,mimeType:'application/pdf'};
 }
 if(officeExtensions.has(extension)){
  const format=extension as keyof typeof officeFormats;
  const {readOfficeText}=await import('./read-office-text');
  const text=await readOfficeText(source,format);
  return {name,size,text,mimeType:officeFormats[format]};
 }
 if(['doc','xls','ppt'].includes(extension)||source[0]===0x50&&source[1]===0x4b)throw new ChatFileReadError('请将此文件另存为 DOCX、XLSX、PPTX 或 UTF-8 文本。');
 const hasUtf16Bom=source[0]===0xff&&source[1]===0xfe||source[0]===0xfe&&source[1]===0xff;
 if(size>(hasUtf16Bom?attachmentLimits.textBytes*2+2:attachmentLimits.textBytes+3))throw new ChatFileReadError(name+' 的文字内容超过 256 KiB。请选择相关片段。');
 let text:string;
 try{text=decodeUnicode(source);}catch{throw new ChatFileReadError('无法读取 '+name+' 的文字。请转换为 UTF-8 文本或选择受支持的文档和图片格式。');}
 return {name,size,text:checkedText(text),mimeType:file.type.startsWith('text/')?file.type:'text/plain'};
}
