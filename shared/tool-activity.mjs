export function toolActivity(item){
 const result=item.result,failed=!!item.error||item.status==='failed'||result?.isError===true;
 let artifact;function walk(v,depth=0){if(depth>8||v==null)return;if(typeof v==='string'){try{walk(JSON.parse(v),depth+1);}catch{}return;}if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(typeof v!=='object')return;if(v.id&&(v.kind==='task-parameters'||v.kind==='cluster-setup'||v.engine))artifact=v;for(const key of ['content','structuredContent','result','text','data'])if(key in v)walk(v[key],depth+1);}
 walk(result);
 const state=failed?'failed':item.status==='completed'||result?'completed':'running';
 return {state,artifact:failed?undefined:artifact,summary:failed?'工具调用失败':artifact?.kind==='task-parameters'?'计算流程草稿已保存':artifact?'已准备模块草稿':state==='completed'?'工具调用完成':'工具正在执行',details:JSON.stringify(result??item.error??item.status,null,2)?.slice(0,16000)||''};
}

export function visibleUserText(content=[]){
 return content.filter(c=>c.type==='text').map((c,index)=>{
  if(index>0&&/^\[Studio (?:workspace context|interaction mode:)/.test(c.text))return '';
  const marker='\n\n[Studio workspace context]\n',position=c.text.indexOf(marker);
  if(position>=0){try{const context=JSON.parse(c.text.slice(position+marker.length));if(context&&typeof context==='object'&&'environments' in context&&'workflow' in context)return c.text.slice(0,position);}catch{}}
  return c.text;
 }).filter(Boolean).join('\n');
}
