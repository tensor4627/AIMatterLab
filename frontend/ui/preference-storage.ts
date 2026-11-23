// Presentation preferences can be lost when browser storage is unavailable.
// Callers that need a durable draft or request receipt must observe write errors.
export function readPreference(key:string, session=false):string|null {
 try { return (session ? sessionStorage : localStorage).getItem(key); }
 catch { return null; }
}

export function writePreference(key:string, value:string, session=false) {
 try { (session ? sessionStorage : localStorage).setItem(key,value); }
 catch { /* The current view still uses its in-memory preference. */ }
}
