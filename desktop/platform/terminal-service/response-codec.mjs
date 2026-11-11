import {inflateRaw,crc32} from 'node:zlib';
/** One ordinary gzip member, with a bounded allocation and no trailing input. */
export function decodeGzipResponse(bytes,size){return new Promise((resolve,reject)=>{
 const bad=()=>reject(Error('service_protocol_failed'));
 if(!Buffer.isBuffer(bytes)||bytes.length<18||!Number.isSafeInteger(size)||size<1||size>8*1024*1024||bytes[0]!==31||bytes[1]!==139||bytes[2]!==8||bytes[3]!==0||bytes.readUInt32LE(bytes.length-4)!==size)return bad();
 const deflate=bytes.subarray(10,-8);
 inflateRaw(deflate,{maxOutputLength:size,info:true},(error,result)=>{
  if(error||result.buffer.length!==size||result.engine.bytesWritten!==deflate.length||crc32(result.buffer)!==bytes.readUInt32LE(bytes.length-8))return bad();
  resolve(result.buffer);
 });
});}
