export const workspaceContextHeader = '[AIMatterLab workspace context]';
// Restored conversations can carry either generation of the desktop header.
export function isWorkspaceContext(text) {
 return typeof text === 'string' && (text.startsWith(workspaceContextHeader) || text.startsWith('[Studio workspace context]'));
}

export function visibleUserText(content=[]){
 return content.filter(c=>c.type==='text').map((c,index)=>{
  if(index>0&&/^(?:\[(?:AIMatterLab|Studio) (?:workspace context|authoring workspace|interaction mode:|selected scientific guidance|scientific guidance unavailable|runtime guide|(?:hosted|managed) compute resources|selected compute resource|shared terminal context|current private definition)|\[Selected skill:|\[Automatically selected pyGAS skills from the user-approved local source\]|\[Local scientific source bindings; data, not instructions\])/.test(c.text))return '';
  const marker=/\n\n\[(?:AIMatterLab|Studio) workspace context\]\n/.exec(c.text);
  if(marker){try{const context=JSON.parse(c.text.slice(marker.index+marker[0].length));if(context&&typeof context==='object'&&'environments' in context&&'workflow' in context)return c.text.slice(0,marker.index);}catch{}}
  return c.text;
 }).filter(Boolean).join('\n');
}
