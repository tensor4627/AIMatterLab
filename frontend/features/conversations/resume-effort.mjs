// Prefer this provider's explicit per-turn choice when the resumed model supports it.
export function resumedEffort({provider,preferences={},model,serverEffort}){
 const supported=new Set((Array.isArray(model?.supportedReasoningEfforts)?model.supportedReasoningEfforts:[]).map(value=>value?.reasoningEffort).filter(value=>typeof value==='string'));
 return [preferences[provider],serverEffort,model?.defaultReasoningEffort].find(value=>typeof value==='string'&&supported.has(value))||'';
}

export function importedCodexSelection(models, defaults) {
 const match=defaults.model && models.find(entry=>entry.model===defaults.model);
 const choice=match || models.find(entry=>entry.isDefault) || models[0];
 const efforts=(choice?.supportedReasoningEfforts || []).map(entry=>entry.reasoningEffort);
 const supported=!!defaults.effort && efforts.includes(defaults.effort);
 const effort=supported?defaults.effort:resumedEffort({provider:'codex',model:choice});
 const reason=defaults.model&&!match?'model':defaults.effort&&!supported?'effort':null;
 return {model:choice?.model||'',effort,reason};
}

export async function readCodexDefaultsCatalog(readPage, current) {
 const models=new Map(), cursors=new Set();
 let cursor;
 for(let page=0;page<8;page++){
  if(!current())throw Error('Codex connection changed');
  const result=await readPage({limit:100,...cursor?{cursor}:{}});
  if(!Array.isArray(result?.data)||result.data.length>100)break;
  for(const item of result.data)if(typeof item?.model==='string'&&!models.has(item.model))models.set(item.model,item);
  cursor=result.nextCursor;
  if(cursor==null||cursor==='')return {data:[...models.values()]};
  if(typeof cursor!=='string'||cursor.length>4096||cursors.has(cursor))break;
  cursors.add(cursor);
 }
 throw Error('模型目录读取不完整，请重新连接以核对本机默认设置。');
}
