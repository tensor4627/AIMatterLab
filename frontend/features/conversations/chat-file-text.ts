import {attachmentLimits} from '../../../contracts/agent/chat-attachments.mjs';

export class ChatFileReadError extends Error {}
const encoder=new TextEncoder();

export function decodeUnicode(bytes:Uint8Array){
 const littleEndian=bytes[0]===0xff&&bytes[1]===0xfe,bigEndian=bytes[0]===0xfe&&bytes[1]===0xff;
 return new TextDecoder(littleEndian?'utf-16le':bigEndian?'utf-16be':'utf-8',{fatal:true}).decode(bytes);
}

export function collectText(){
 const parts:string[]=[];
 let bytes=0;
 return {
  append(value:string){
   bytes+=encoder.encode(value).length;
   if(bytes>attachmentLimits.textBytes)throw new ChatFileReadError('文字内容超过 256 KiB。请选择相关页或片段。');
   parts.push(value);
  },
  text:()=>parts.join('').trim(),
 };
}

export function checkedText(value:string,emptyMessage='文件中没有可读取的文字。'){
 const text=collectText();text.append(value);
 if(!value.trim())throw new ChatFileReadError(emptyMessage);
 if(/[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(value))throw new ChatFileReadError('文件包含二进制数据。请转换为 UTF-8 文本后重试。');
 return value;
}
