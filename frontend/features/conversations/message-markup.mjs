// Display-only Markdown subset. All leaves remain strings; no HTML, URLs or executable nodes.
export function inlineMarkup(text,depth=0){
 const nodes=[];const append=value=>{if(!value)return;const last=nodes.at(-1);if(last?.type==='text')last.text+=value;else nodes.push({type:'text',text:value});};
 for(let i=0;i<text.length;){
  if(text[i]==='\\'&&/[\\`*_{}\[\]()#+.!|>~-]/.test(text[i+1]||'')){append(text[i+1]);i+=2;continue;}
  const character=text[i],code=character==='`',bold=depth<2&&(text.startsWith('**',i)||text.startsWith('__',i));
  if(code||bold){
   let length=2;if(code){length=1;while(text[i+length]==='`')length++;}
   const marker=text.slice(i,i+length);let end=text.indexOf(marker,i+length);
   while(end>=0&&(text[end-1]===character||text[end+length]===character))end=text.indexOf(marker,end+length);
   if(end<0){append(text.slice(i));break;}
   const value=text.slice(i+length,end);if(!value){append(marker);i+=length;continue;}
   nodes.push(code?{type:'code',text:value}:{type:'strong',children:inlineMarkup(value,depth+1)});i=end+length;continue;
  }
  append(text[i]);i++;
 }
 return nodes;
}

const fence=line=>line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);

const heading=line=>line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
// Only unescaped pipes delimit cells; GFM unescapes a pipe even inside a code span.
const cells=line=>{
 let source=line.trim();if(source.startsWith('|'))source=source.slice(1);
 let slashes=0;for(let j=source.length-2;j>=0&&source[j]==='\\';j--)slashes++;
 if(source.endsWith('|')&&slashes%2===0)source=source.slice(0,-1);
 const result=[];let value='',escaped=false;
 for(const char of source){if(char==='|'&&!escaped){result.push(value.trim());value='';}else if(char==='|'&&escaped)value=value.slice(0,-1)+'|';else value+=char;escaped=char==='\\'?!escaped:false;}
 result.push(value.trim());return result;
};
const tableStart=(lines,i)=>{
 if(i+1>=lines.length||!lines[i].includes('|'))return null;
 const header=cells(lines[i]),delimiter=cells(lines[i+1]);
 if(header.length!==delimiter.length||!delimiter.every(cell=>/^:?-+:?$/.test(cell)))return null;
 return {header,align:delimiter.map(cell=>cell.startsWith(':')?(cell.endsWith(':')?'center':'left'):(cell.endsWith(':')?'right':null))};
};

const item=line=>line.match(/^ {0,3}(?:([-+*])|([0-9]{1,9})[.)])\s+(.+)$/);

export function messageMarkup(raw){
 const lines=raw.replace(/\r\n?/g,'\n').split('\n'),blocks=[];let i=0;
 while(i<lines.length){
  if(!lines[i].trim()){i++;continue;}
  const opening=fence(lines[i]);
  if(opening){
   const first=i,marker=opening[1];i++;const start=i;
   while(i<lines.length&&!new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}\\s*$').test(lines[i]))i++;
   const closed=i<lines.length;blocks.push({type:'code',text:closed?lines.slice(start,i).join('\n')+(i>start?'\n':''):lines.slice(first,i).join('\n'),closed});if(closed)i++;continue;
  }
  const title=heading(lines[i]);
  if(title){blocks.push({type:'heading',level:title[1].length,text:(title[2]||'').replace(/[ \t]+#+[ \t]*$/,'').trim()});i++;continue;}
  const table=tableStart(lines,i);
  if(table){i+=2;const rows=[];while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')&&!fence(lines[i])&&!heading(lines[i])&&!item(lines[i])){const row=cells(lines[i++]);rows.push(table.header.map((_,column)=>row[column]||''));}blocks.push({type:'table',...table,rows});continue;}
  const entry=item(lines[i]);
  if(entry){
   const ordered=entry[2]!==undefined,items=[],start=ordered?Number(entry[2]):1;
   while(i<lines.length){const row=item(lines[i]);if(!row||(row[2]!==undefined)!==ordered)break;items.push(row[3]);i++;}
   blocks.push({type:ordered?'ol':'ul',start,items});continue;
  }
  const start=i;i++;while(i<lines.length&&lines[i].trim()&&!fence(lines[i])&&!item(lines[i])&&!heading(lines[i])&&!tableStart(lines,i))i++;
  blocks.push({type:'paragraph',text:lines.slice(start,i).join('\n')});
 }
 return blocks;
}
