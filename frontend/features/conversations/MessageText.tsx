import {memo,useMemo,createElement,type ReactNode} from 'react';
import {inlineMarkup,messageMarkup,type InlineMarkup} from "./message-markup.mjs";

import './message-markup.css';
function inline(nodes:InlineMarkup[]):ReactNode{return nodes.map((node,index)=>node.type==='strong'?<strong key={index}>{inline(node.children)}</strong>:node.type==='code'?<code key={index}>{node.text}</code>:node.text);}
export default memo(function MessageText({text}:{text:string}){
 // Keep completed markup, including inline parsing, stable while another message streams.
 return useMemo(()=>{const blocks=messageMarkup(text);return <div className="message-markup">{blocks.map((block,index)=>block.type==='heading'?createElement('h'+block.level,{key:index},inline(inlineMarkup(block.text))):block.type==='table'?<div key={index} className="message-table-scroll" tabIndex={0} role="region" aria-label="表格"><table><thead><tr>{block.header.map((cell,column)=><th key={column} style={{textAlign:block.align[column]||undefined}}>{inline(inlineMarkup(cell))}</th>)}</tr></thead><tbody>{block.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,column)=><td key={column} style={{textAlign:block.align[column]||undefined}}>{inline(inlineMarkup(cell))}</td>)}</tr>)}</tbody></table></div>:block.type==='code'?<pre key={index} data-incomplete={block.closed?undefined:'true'}><code>{block.text}</code></pre>:block.type==='ol'?<ol key={index} start={block.start}>{block.items.map((text,item)=><li key={item}>{inline(inlineMarkup(text))}</li>)}</ol>:block.type==='ul'?<ul key={index}>{block.items.map((text,item)=><li key={item}>{inline(inlineMarkup(text))}</li>)}</ul>:<p key={index}>{inline(inlineMarkup(block.text))}</p>)}</div>;},[text]);
});
