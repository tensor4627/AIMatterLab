const jsonToken=/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g;

export function isJsonObject(value){
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}

// Compare the decimal value rather than its spelling. Keep the sign of zero
// because JSON.stringify otherwise changes it to positive zero.
function decimal(raw){
 const [mantissa,exponent='0']=raw.toLowerCase().split('e');
 const [whole,fraction='']=mantissa.split('.');
 const digits=(whole+fraction).replace(/^-?0*/,'');
 const significant=digits.replace(/0+$/,'');
 const sign=mantissa.startsWith('-')?'-':'';
 if(!significant)return sign+'0';
 return sign+significant+'e'+(Number(exponent)-fraction.length+digits.length-significant.length);
}

export function inspectJsonDraft(source){
 let value;
 try{value=JSON.parse(source);}catch{return null;}
 let root,duplicateKeys=false,lossyNumbers=false;
 const stack=[];

 // JSON.parse checks the grammar. The scan retains the original ranges and
 // catches duplicate keys and numeric values that JSON transport would change.
 for(const {0:token,index:start} of source.matchAll(jsonToken)){
  if(token===':'||token===',')continue;
  if(token==='}'||token===']'){
   stack.pop().node.end=start+1;
   continue;
  }
  const parent=stack.at(-1);
  if(parent?.node.kind==='object'&&parent.member===null){
   const key=JSON.parse(token);
   if(parent.keys.has(key))duplicateKeys=true;
   parent.keys.add(key);
   parent.member={key,start};
   continue;
  }
  const end=start+token.length;
  const node=token==='{'?{kind:'object',start,end,members:[]}:
   token==='['?{kind:'array',start,end,items:[]}:{kind:'scalar',start,end};
  if(parent?.node.kind==='object'){
   parent.node.members.push({...parent.member,value:node});
   parent.member=null;
  }else if(parent?.node.kind==='array')parent.node.items.push(node);
  else root=node;
  if(node.kind==='object')stack.push({node,keys:new Set(),member:null});
  else if(node.kind==='array')stack.push({node});
  else if(/^-?\d/.test(token)&&!lossyNumbers){
   const number=Number(token);
   lossyNumbers=!Number.isFinite(number)||decimal(token)!==decimal(JSON.stringify(number));
  }
 }
 return {source,value,root,duplicateKeys,lossyNumbers};
}

export function jsonDraftIssue(document){
 return document.duplicateKeys?'duplicate':document.lossyNumbers?'number':null;
}

function child(node,key){
 if(node?.kind==='object'&&typeof key==='string')return node.members.findLast(member=>member.key===key)?.value;
 if(node?.kind==='array'&&typeof key==='number')return node.items[key];
}

export function jsonDraftValueSource(document,path){
 let node=document.root;
 for(const key of path)node=child(node,key);
 return node&&document.source.slice(node.start,node.end);
}

// An encoded value replaces only its own range. Callers can opt into editing
// an effective duplicate value, but must resolve duplicates before sending.
export function editJsonDraft(sourceOrDocument,path,encoded,{duplicateKeys}={}){
 const document=typeof sourceOrDocument==='string'?inspectJsonDraft(sourceOrDocument):sourceOrDocument;
 const source=typeof sourceOrDocument==='string'?sourceOrDocument:sourceOrDocument.source;
 if(!document||!path.length||document.duplicateKeys&&(duplicateKeys!=='last'||encoded===undefined))return source;
 const replace=(start,end,value='')=>source.slice(0,start)+value+source.slice(end);
 function edit(node,depth){
  const key=path[depth],last=depth===path.length-1;
  const entries=node.kind==='array'?node.items:node.kind==='object'?node.members.map(member=>({start:member.start,end:member.value.end})):[];
  const index=node.kind==='object'&&typeof key==='string'?node.members.findLastIndex(member=>member.key===key):
   node.kind==='array'&&typeof key==='number'&&Number.isInteger(key)&&key>=0&&key<entries.length?key:-1;
  if(index>=0){
   const value=child(node,key);
   if(!last)return edit(value,depth+1);
   if(encoded!==undefined)return replace(value.start,value.end,encoded);
   const entry=entries[index];
   if(index+1<entries.length)return replace(entry.start,entries[index+1].start);
   return replace(index>0?entries[index-1].end:entry.start,entry.end);
  }
  if(encoded===undefined)return source;
  let addition=encoded;
  if(node.kind==='object'&&typeof key==='string'){
   for(let i=path.length-1;i>depth;i--){
    if(typeof path[i]!=='string')return source;
    addition='{'+JSON.stringify(path[i])+': '+addition+'}';
   }
   addition=JSON.stringify(key)+': '+addition;
  }else if(node.kind!=='array'||key!==entries.length||!last)return source;
  const end=entries.at(-1)?.end??node.start+1;
  return replace(end,end,(entries.length?', ':'')+addition);
 }
 return edit(document.root,0);
}
