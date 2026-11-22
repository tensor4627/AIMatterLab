// Preserve the source's line endings, including an empty line inside a file.
export function evidenceLines(text){
 return text.match(/[^\r\n]*(?:\r\n|[\r\n])|[^\r\n]+$/g)||[];
}

export function evidenceParameter(value){
 return JSON.stringify(value??null,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item,2);
}

export function evidenceDifference(before,after){
 const a=evidenceLines(before),b=evidenceLines(after);
 let start=0,end=0;
 while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
 while(end<Math.min(a.length,b.length)-start&&a[a.length-end-1]===b[b.length-end-1])end++;
 return {
  before:{firstLine:start+1,lastLine:a.length-end,text:a.slice(start,a.length-end).join('')},
  after:{firstLine:start+1,lastLine:b.length-end,text:b.slice(start,b.length-end).join('')}
 };
}
