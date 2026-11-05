import {useRef} from 'react';
import {MessageSquare,GitBranch,PanelLeft} from 'lucide-react';
import {t} from "../../ui/i18n";
export default function ConversationCommands({query,blocked,onDismiss,onNewConversation,onShowConversations}:{query:string;blocked:boolean;onDismiss:()=>void;onNewConversation:(planning:boolean)=>void;onShowConversations:()=>void}){
 const current=useRef({blocked,onDismiss,onNewConversation,onShowConversations}),used=useRef(false);current.current={blocked,onDismiss,onNewConversation,onShowConversations};
 const actions=[{id:'conversation',label:'新对话',aliases:['new chat','new conversation'],Icon:MessageSquare},{id:'planning',label:'新建计算任务',aliases:['new task','new computation','planning'],Icon:GitBranch},{id:'list',label:'显示会话列表',aliases:['chat list','conversations','sidebar','侧栏'],Icon:PanelLeft}] as const;
 function activate(id:typeof actions[number]['id']){const owner=current.current;if(owner.blocked||used.current)return;used.current=true;owner.onDismiss();if(id==='list')owner.onShowConversations();else owner.onNewConversation(id==='planning');}
 const search=query.trim().toLocaleLowerCase();
 return <>{actions.filter(action=>[action.label,t(action.label),...action.aliases].some(label=>label.toLocaleLowerCase().includes(search))).map(action=><button key={action.id} disabled={blocked} onClick={()=>activate(action.id)}><action.Icon size={17}/>{t(action.label)}</button>)}</>;
}
