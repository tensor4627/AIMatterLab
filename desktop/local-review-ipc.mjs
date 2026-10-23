import {createTaskLocalReview} from './task-local-review.mjs';
/** Only the trusted desktop registers these typed human channels; none are MCP/admin worker routes. */
export function registerLocalReview({handle,...dependencies}){
 const api=createTaskLocalReview(dependencies);
 for(const name of ['inspect','read','confirm','status'])handle('task.localReview.'+name,(value,event)=>api[name](value,event));
 return api;
}
