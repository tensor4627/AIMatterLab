import Disclosure from '../../ui/Disclosure';
import {useRef} from 'react';
export default function QueueChoices({queues,value,onChange,language='zh-CN'}:{queues:unknown;value:string;onChange:(value:string)=>void;language?:'zh-CN'|'en'}){
 const details=useRef<HTMLDetailsElement>(null),zh=language==='zh-CN';
 const valid=Array.isArray(queues)?[...new Set(queues.filter((q):q is string=>typeof q==='string'&&q.length>0&&q.length<=256))]:[];
 if(!valid.length)return <small>{zh?'尚无探测到的队列，可手输或先在环境探测页进行只读探测。':'No detected queues. Enter one manually or use the read-only environment probe.'}</small>;
 return <Disclosure ref={details} className="queue-choices" variant="section" summary={<>{zh?'从探测结果选择队列':'Choose a detected queue'} · {valid.length}{valid.includes(value)?' · '+value:''}</>}><div role="group" aria-label={zh?'探测队列':'Detected queues'}>{valid.map(queue=><button key={queue} type="button" aria-pressed={value===queue} onClick={()=>{onChange(queue);if(details.current){details.current.open=false;details.current.querySelector('summary')?.focus();}}}>{queue}</button>)}</div><small>{zh?'选中只修改待保存表单，不保存配置、不提交任务。':'Selection changes only this unsaved form; it neither saves settings nor submits jobs.'}</small></Disclosure>;
}
