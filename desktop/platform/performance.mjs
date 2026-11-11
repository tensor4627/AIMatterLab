import fs from 'node:fs';
import path from 'node:path';

const phases=new Set(['desktop-initialize','window-created','window-loaded','renderer-interactive','workspace-observed']);
/** Small, path-free timing receipt. Persistence is explicitly enabled by the test host. */
export function createPerformanceTimeline({now=()=>performance.now(),wall=Date.now,output=process.env.STUDIO_PERFORMANCE_ROOT}={}){
 const marks=[];let writes=Promise.resolve();
 function mark(phase){
  if(!phases.has(phase))throw Error('Invalid performance phase');
  if(marks.some(value=>value.phase===phase))return snapshot();
  marks.push({phase,sinceStartMs:Math.round(now()*1000)/1000,observedAt:wall()});
  if(output){const body=JSON.stringify(snapshot(),null,2);writes=writes.then(async()=>{await fs.promises.mkdir(output,{recursive:true});await fs.promises.writeFile(path.join(output,'desktop-timing.json'),body);}).catch(()=>{});}
  return snapshot();
 }
 function snapshot(){return {schemaVersion:1,scope:'Observed desktop process and renderer phases; excludes launcher extraction',marks:marks.map(value=>({...value}))};}
 return {mark,snapshot,flush:()=>writes};
}
