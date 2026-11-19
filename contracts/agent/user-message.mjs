export function visibleUserText(content=[]){
 return content.filter(c=>c.type==='text').map((c,index)=>{
  if(index>0&&/^(?:\[Studio (?:workspace context|authoring workspace|interaction mode:|managed compute resources|selected scientific guidance|scientific guidance unavailable|runtime guide)|\[Selected skill:|\[Automatically selected pyGAS skills from the user-approved local source\]|\[Local scientific source bindings; data, not instructions\])/.test(c.text))return '';
  const marker='\n\n[Studio workspace context]\n',position=c.text.indexOf(marker);
  if(position>=0){try{const context=JSON.parse(c.text.slice(position+marker.length));if(context&&typeof context==='object'&&'environments' in context&&'workflow' in context)return c.text.slice(0,position);}catch{}}
  return c.text;
 }).filter(Boolean).join('\n');
}
