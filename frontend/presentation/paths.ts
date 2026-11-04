/** Renderer path formatting only; main/worker authorization remains authoritative. */
export function wslPath(path:string){return /^[a-z]:[\\/]/i.test(path)?'/mnt/'+path[0].toLowerCase()+'/'+path.slice(3).replaceAll('\\','/'):path}
