import type {StudioMethod,StudioRequest,StudioResponse} from '../../contracts/dto/ipc';
import {invoke} from './studio';

type HistoryMethod=Extract<StudioMethod,`conversation.history.${string}`>;
function call<M extends HistoryMethod>(method:M,data:StudioRequest<M>){
 return invoke<StudioResponse<M>>(method,data);
}
export const hasConversationHistory=()=>typeof window!=='undefined'&&window.studio?.conversationHistory===true;
export const conversationHistory={
 page:(data:StudioRequest<'conversation.history.page'>)=>call('conversation.history.page',data),
 locate:(data:StudioRequest<'conversation.history.locate'>)=>call('conversation.history.locate',data),
 detail:(data:StudioRequest<'conversation.history.detail'>)=>call('conversation.history.detail',data),
 search:(data:StudioRequest<'conversation.history.search'>)=>call('conversation.history.search',data),
 bookmark:(data:StudioRequest<'conversation.history.bookmark'>)=>call('conversation.history.bookmark',data),
 archive:(data:StudioRequest<'conversation.history.archive'>)=>call('conversation.history.archive',data),
 branch:(data:StudioRequest<'conversation.history.branch'>)=>call('conversation.history.branch',data),
};
