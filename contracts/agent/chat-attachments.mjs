// Only small display references enter drafts, queue snapshots and the transcript UI.
export const attachmentHeader='[AIMatterLab user-selected attachments v1]';
export const attachmentLimits=Object.freeze({count:8,textBytes:256*1024,imageBytes:8*1024*1024,totalBytes:16*1024*1024,documentBytes:20*1024*1024});
export const imageTypes=Object.freeze(['image/png','image/jpeg','image/webp','image/gif']);
export function chatImageMime(bytes){
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte))return 'image/png';
 if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 const signature=String.fromCharCode(...bytes.subarray(0,12));
 if(signature.startsWith('RIFF')&&signature.slice(8)==='WEBP')return 'image/webp';
 if(signature.startsWith('GIF87a')||signature.startsWith('GIF89a'))return 'image/gif';
 return null;
}
export function attachmentPrompt(files=[]){return files.length?'请查看附件：'+files.map(file=>file.name).join('、'):'';}
export function attachmentsAfterReplacement(files=[],uploadsRetained){
 return uploadsRetained===true?files.filter(file=>!file.source):[];
}
const evidenceRevision=value=>typeof value==='string'&&/^(?:r\d{1,16}\/)?[a-f0-9]{64}$/.test(value);
function validEvidenceSource(source){
 if(!source||!['input','log','artifact','parameters'].includes(source.kind)||typeof source.label!=='string'||!source.label||source.label.length>255||
  !Number.isSafeInteger(source.firstLine)||source.firstLine<1||!Number.isSafeInteger(source.lastLine)||source.lastLine<source.firstLine||!evidenceRevision(source.revision))return false;
 for(const field of ['projectId','taskId','runId','field','unit'])if(source[field]!==undefined&&(typeof source[field]!=='string'||source[field].length>200||/[\x00-\x1f]/.test(source[field])))return false;
 const comparison=source.comparison;
 return comparison===undefined||!!comparison&&evidenceRevision(comparison.beforeRevision)&&comparison.afterRevision===source.revision;
}
export function validAttachmentRef(file){
 return !!file&&typeof file.id==='string'&&/^[\da-f-]{36}$/i.test(file.id)&&typeof file.name==='string'&&file.name.length>0&&file.name.length<=255&&
  ['text','image'].includes(file.kind)&&typeof file.mimeType==='string'&&Number.isSafeInteger(file.size)&&file.size>=0&&
  (file.source===undefined||file.kind==='text'&&validEvidenceSource(file.source));
}
export function chatAttachmentRefs(content=[]){
 for(const item of content){
  if(item?.type!=='text'||typeof item.text!=='string')continue;
  // Native providers may replay separate text blocks as a single string.
  const offset=attachmentOffset(item.text);if(offset<0)continue;
  const start=offset+attachmentHeader.length+1,end=item.text.indexOf('\n',start);
  if(end<0||end-start>24000)continue;
  try{const data=JSON.parse(item.text.slice(start,end));if(Array.isArray(data)&&data.length<=attachmentLimits.count&&data.every(validAttachmentRef))return data;}catch{}
 }
 return [];
}
export function attachmentOffset(text){
 if(text.startsWith(attachmentHeader+'\n'))return 0;
 const found=text.indexOf('\n'+attachmentHeader+'\n');return found<0?-1:found+1;
}
