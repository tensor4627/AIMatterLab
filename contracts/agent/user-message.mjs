import {titleReviewPrefix} from './conversation-title.mjs';

export const workspaceContextHeader = '[AIMatterLab workspace context]';
// Restored conversations can carry either generation of the desktop header.
export function isWorkspaceContext(text) {
 return typeof text === 'string' && (text.startsWith(workspaceContextHeader) || text.startsWith('[Studio workspace context]'));
}

export function visibleUserText(content=[]){
 return content.filter(c=>c.type==='text'&&typeof c.text==='string').map((c,index)=>{
  if(index>0&&c.text.startsWith(titleReviewPrefix))return '';
  if(index>0&&/^(?:\[(?:AIMatterLab|Studio) (?:workspace context|authoring workspace|interaction mode:|selected scientific guidance|scientific guidance unavailable|runtime guide|(?:hosted|managed) compute resources|selected compute resource|shared terminal context|current private definition)|\[Selected skill:|\[Automatically selected pyGAS skills from the user-approved local source\]|\[Local scientific source bindings; data, not instructions\])/.test(c.text))return '';
  // Some native histories replay all text blocks as a single user message.
  const offset=c.text.lastIndexOf('\n'+titleReviewPrefix);
  const text=offset>=0&&/^[\da-f-]{36} while answering this turn\./.test(c.text.slice(offset+1+titleReviewPrefix.length))?c.text.slice(0,offset).trimEnd():c.text;
  const marker=/\n\n\[(?:AIMatterLab|Studio) workspace context\]\n/.exec(text);
  if(marker){try{const context=JSON.parse(text.slice(marker.index+marker[0].length));if(context&&typeof context==='object'&&'environments' in context&&'workflow' in context)return text.slice(0,marker.index);}catch{}}
  return text;
 }).filter(Boolean).join('\n');
}
