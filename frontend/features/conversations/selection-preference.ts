export function storedConversation(){try{return localStorage.getItem('studio.conversation');}catch{return null;}}
export function storeConversation(id:string|null){try{if(id)localStorage.setItem('studio.conversation',id);else localStorage.removeItem('studio.conversation');}catch{/* Selection preferences must not block chat. */}}
