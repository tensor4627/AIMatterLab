import {useMemo,type ReactNode} from 'react';
import {inlineMarkup,messageMarkup,type InlineMarkup} from "./message-markup.mjs";

import './message-markup.css';
function inline(nodes:InlineMarkup[]):ReactNode{return nodes.map((node,index)=>node.type==='strong'?<strong key={index}>{inline(node.children)}</strong>:node.type==='code'?<code key={index}>{node.text}</code>:node.text);}
export default function MessageText({text}:{text:string}){
 const blocks=useMemo(()=>messageMarkup(text),[text]);
 return <div className="message-markup">{blocks.map((block,index)=>block.type==='code'?<pre key={index} data-incomplete={block.closed?undefined:'true'}><code>{block.text}</code></pre>:block.type==='ol'?<ol key={index} start={block.start}>{block.items.map((text,item)=><li key={item}>{inline(inlineMarkup(text))}</li>)}</ol>:block.type==='ul'?<ul key={index}>{block.items.map((text,item)=><li key={item}>{inline(inlineMarkup(text))}</li>)}</ul>:<p key={index}>{inline(inlineMarkup(block.text))}</p>)}</div>;
}
