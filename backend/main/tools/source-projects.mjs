/** Read-only discovery. Authoring sources never change engine registrations. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const definitions={pygas:['pyproject.toml','base/colvar.py','tools/graph_workflow.py'],pydyn:['pyproject.toml','pydyn'],gpumd:['src/main_gpumd/run.cu'],hotpp:['setup.py','hotpp'],torchnep:['pyproject.toml']};
export function discoverSources({cwd,applicationRoot,roots=[],ids}){
 const parents=[cwd&&path.dirname(cwd),applicationRoot&&path.dirname(applicationRoot)].filter(Boolean);
 const candidates=[...roots,...parents.flatMap(p=>Object.keys(definitions).map(n=>path.join(p,n==='gpumd'?'GPUMD':n)))];
 const seen=new Set(),result=[];
 for(const candidate of candidates){
  if(typeof candidate!=='string'||!path.isAbsolute(candidate)||!fs.existsSync(candidate))continue;
  const actual=fs.realpathSync(candidate);if(seen.has(actual.toLowerCase()))continue;seen.add(actual.toLowerCase());
  const name=path.basename(actual).toLowerCase(),required=definitions[name];if(ids&&!ids.includes(name))continue;if(!required||!required.every(f=>fs.existsSync(path.join(actual,f))))continue;
  const files=required.filter(f=>fs.statSync(path.join(actual,f)).isFile()).map(f=>({name:f,sha256:createHash('sha256').update(fs.readFileSync(path.join(actual,f))).digest('hex')}));
  let commit=null,dirty=null;try{const git=a=>execFileSync('git',['--no-optional-locks','-C',actual,...a],{encoding:'utf8',windowsHide:true,timeout:4000});commit=git(['rev-parse','HEAD']).trim();dirty=!!git(['status','--porcelain']).trim();}catch{}
  result.push({id:name,name,root:actual,commit,dirty,files,status:'passed',scope:'authoring source only; target environment must be validated separately'});
 }
 return result;
}

export function toolInventory(sources){return ['pygas','pydyn','gpumd','hotpp','torchnep','nepmaker','activemiao'].map(id=>({id,source_status:sources.some(s=>s.id===id)?'passed':'blocked',runtime_status:'not_run',adapter_status:['torchnep','nepmaker','activemiao'].includes(id)?'planned':'available'}));}
