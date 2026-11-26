import {t} from '../../ui/i18n';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {useEffect,useState} from 'react';
import type {Expected,LibraryItem} from './custom-cv-types';
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const usable=(e:Expected|null|undefined):e is Expected=>!!e&&hash(e.specSha)&&hash(e.parametersSha)&&(e.codeSha===null||hash(e.codeSha))&&typeof e.revision==='string'&&/^[a-f0-9]{32}$/.test(e.revision);
/** Foreign entries remain metadata only. A human reuse action must create a new owned identity first. */
export default function CustomCvLibrary(p:{entries:LibraryItem[];currentId?:string;busy:boolean;dirty?:boolean;reuseSupported:boolean;language?:'zh-CN'|'en';onSelect?:(id:string)=>void;onReuse?:(id:string,expected:Expected)=>void|Promise<void>}){
 const locale = {language:p.language??'zh-CN'} as const;

 const [selected,setSelected]=useState('');
 const own=p.entries.filter(e=>e.owned===true||e.id===p.currentId),foreign=p.entries.filter(e=>e.owned===false&&e.id!==p.currentId),entry=foreign.find(e=>e.id===selected);
 useEffect(()=>{if(!foreign.some(e=>e.id===selected))setSelected('');},[JSON.stringify(foreign.map(e=>[e.id,e.expected])),selected]);
 return <section className="ccv-library"><label>{t("当前流程的私有定义", locale)}<select aria-label="custom.library" value={p.currentId||''} disabled={p.busy||p.dirty||!p.onSelect} onChange={event=>{const item=own.find(e=>e.id===event.target.value);if(item)p.onSelect?.(item.id);}}>{!p.currentId&&<option value="">{t("尚无当前定义", locale)}</option>}{own.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
 {!!foreign.length&&<Disclosure className="ccv-reuse" summary={<>{t("从私有库复制一个定义", locale)}</>}><p>{t("这里只显示名称与版本元数据。显式复制会创建当前流程自己的 ID；旧条目不变，共享许可与结构数值检查全部重置。数学与代码审阅来源可以保留，不能代表当前结构通过。", locale)}</p><select aria-label="custom.reuse.library" value={selected} disabled={p.busy||p.dirty} onChange={event=>setSelected(event.target.value)}><option value="">{t("选择要复制的定义", locale)}</option>{foreign.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>{entry&&<small>spec SHA256 {entry.specSha} · {t("原条目历史检查", locale)}: {entry.numericalStatus}</small>}<button type="button" data-testid="custom-reuse" disabled={p.busy||p.dirty||!p.reuseSupported||!p.onReuse||!entry||!usable(entry.expected)} onClick={()=>{if(entry&&usable(entry.expected))void p.onReuse?.(entry.id,entry.expected);}}>{t("复制为当前流程定义", locale)}</button>{(!p.reuseSupported||!p.onReuse)&&<Notice compact >{t("当前后端尚未提供复用能力；没有读取外部定义源码。", locale)}</Notice>}{entry&&!usable(entry.expected)&&<Notice compact >{t("缺少精确版本锚，刷新私有库后重试。", locale)}</Notice>}</Disclosure>}
 </section>;
}
