// Session-only view preferences. No structure coordinates, file contents or credentials.
export function viewStateCache<T>(limit=32){
 const values=new Map<string,T>();
 return {
  get(key:string|undefined){if(!key)return undefined;const value=values.get(key);if(value!==undefined){values.delete(key);values.set(key,value);}return value;},
  set(key:string|undefined,value:T){if(!key)return;values.delete(key);values.set(key,value);while(values.size>limit)values.delete(values.keys().next().value!);}
 };
}
