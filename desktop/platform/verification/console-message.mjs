/** Normalize Electron's console-message event across the old and new signatures. */
export function consoleMessage(args){
 const [,second,third] = Array.isArray(args)?args:[];
 if(second&&typeof second==='object')return {level:second.level??0,message:String(second.message??'')};
 return {level:second??0,message:String(third??'')};
}
