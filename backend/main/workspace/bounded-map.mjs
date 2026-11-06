/** Bounded in-memory ownership cache: refreshes insertion order and evicts the oldest entry. */
export function remember(map,key,value,{max=128}={}){
 if(!(map instanceof Map))throw Error('remember requires a Map');
 if(!Number.isSafeInteger(max)||max<1||max>100000)throw Error('Invalid bounded-map size');
 map.delete(key);map.set(key,value);
 while(map.size>max)map.delete(map.keys().next().value);
 return value;
}
