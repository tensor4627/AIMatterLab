export interface Caption {lines:string[];width:number}

const words=new Intl.Segmenter(undefined,{granularity:'word'});
const measuring=typeof document==='undefined'?null:document.createElement('canvas').getContext('2d');
const font='600 16px "Segoe UI","Microsoft YaHei UI",sans-serif';
if(measuring)measuring.font=font;

function width(text:string){
 if(measuring)return Math.ceil(measuring.measureText(text).width)+2;
 return Array.from(text).reduce((sum,ch)=>sum+(ch.codePointAt(0)!>255?16:10),2);
}

// Break only between words. The layout and SVG use the same 16-unit type size.
function fit(text:string,limit:number):Caption|undefined{
 if(!text)return;
 const single=width(text);
 if(single<=limit)return {lines:[text],width:single};
 if(single>2*limit+8)return;
 let best:Caption|undefined;
 for(const {index} of words.segment(text)){
  if(!index)continue;
  const left=text.slice(0,index).trimEnd(),right=text.slice(index).trimStart();
  if(!left||!right)continue;
  const required=Math.max(width(left),width(right));
  if(required<=limit&&(!best||required<best.width))best={lines:[left,right],width:required};
 }
 return best;
}

export function caption(label:string,short:string|undefined,alternative:string,fallback:string,file=false):Caption{
 if(short){
  const result=fit(short,140);
  if(result)return result;
  const letters=Array.from(short),middle=Math.ceil(letters.length/2);
  const lines=[letters.slice(0,middle).join(''),letters.slice(middle).join('')];
  return {lines,width:Math.max(...lines.map(width))};
 }
 let name=label.trim().replace(/\s+/g,' ');
 if(file&&(/^(?:[A-Za-z]:[\\/]|[~.]{0,2}[\\/]|\\\\)/.test(name)||/[\\/][^\\/]+\.\w+$/.test(name))){
  name=name.split(/[\\/]/).filter(Boolean).at(-1)||name;
 }
 const phrase=name.split(/\s+[–—-]\s+|[：；;，,（(。]|:\s+/,1)[0].trim();
 const acronym=name.match(/[（(]([A-Za-z][A-Za-z0-9-]{1,9})[）)]/)?.[1];
 for(const candidate of [acronym,name,phrase,alternative]){
  if(candidate&&candidate.length<=16){
   const result=fit(candidate,112);
   if(result)return result;
  }
 }
 return {lines:[fallback],width:width(fallback)};
}

// Paths can share a basename, and the same tool can be invoked more than once.
export function distinguish(captions:Caption[]){
 const matches=new Map<string,Caption[]>();
 for(const item of captions){
  const key=item.lines.join(' ');
  const group=matches.get(key);
  if(group)group.push(item);else matches.set(key,[item]);
 }
 const reserved=new Set(matches.keys());
 for(const [key,group] of matches){
  if(group.length===1)continue;
  let number=0;
  for(const item of group){
   do{number++;}while(reserved.has(key+' · '+number));
   item.lines[item.lines.length-1]+=' · '+number;
   reserved.add(key+' · '+number);item.width=Math.max(...item.lines.map(width));
  }
 }
}
