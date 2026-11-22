import {visibleUserText} from './user-message.mjs';
import {redactTranscriptText} from './transcript-sanitizer.mjs';
import {attachmentOffset} from './chat-attachments.mjs';

export function conversationText(item){
 if(item?.type==='userMessage'){
  const content=Array.isArray(item.content)?item.content:[{type:'text',text:item.text}];
  const text=visibleUserText(content),offset=attachmentOffset(text);
  return text.startsWith('[AIMatterLab scheduled service notification ')?'':redactTranscriptText(offset<0?text:text.slice(0,offset).trimEnd());
 }
 if(['agentMessage','serviceMessage'].includes(item?.type)&&typeof item.text==='string')return redactTranscriptText(item.text);
 return '';
}

export function historyTextItem(item){
 return ['userMessage','agentMessage','serviceMessage','plan','contextCompaction'].includes(item?.type);
}
