import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const SHA=/^[a-f0-9]{64}$/;
const basename=value=>typeof value==='string'?value.replaceAll('\\','/').split('/').at(-1):null;
const own=(object,key)=>!!object&&Object.hasOwn(object,key);
const unstarted=run=>run&&run.status==='draft'&&['identity','started_at','ended_at','exit','exit_code','submitted_at','scheduler_id','job_id'].every(key=>run[key]===undefined||run[key]===null);
function snapshots(run){
 const rows=run?.snapshots;
 if(!Array.isArray(rows)||!rows.length||rows.length>100||rows.some(row=>!row||typeof row.name!=='string'||basename(row.name)!==row.name||!SHA.test(row.sha256)||!Number.isSafeInteger(row.size)||row.size<0||typeof row.source!=='string'||!row.source)||new Set(rows.map(row=>row.name)).size!==rows.length)return null;
 return rows.map(({name,sha256,size,source})=>({name,sha256,size,source})).sort((a,b)=>a.name.localeCompare(b.name));
}
function humanManifestChoice(task,manifest){
 const sensitive=['bias','manifest_file','bias.manifest_file','files'];
 if(Object.keys(task.manualEdits||{}).some(key=>sensitive.includes(key)||key.startsWith('bias.manifest_file.')||key.startsWith('manifest_file.')||key.includes('manifest')))return true;
 for(const [key,receipt] of Object.entries(task.manualInputs||{})){
  if(key.includes('manifest'))return true;
  const values=Array.isArray(receipt?.approvedValues)?receipt.approvedValues:receipt?.value===undefined?[]:Array.isArray(receipt.value)?receipt.value:[receipt.value];
  if(values.some(value=>value===manifest.name||value===manifest.source))return true;
 }
 return false;
}
function noDeploymentDeclaration(value,depth=0,budget={count:0}){
 if(depth>8||++budget.count>2048)return false;
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return true;
 if(typeof value==='string')return value.length<=8192&&!/(\baoti\b|\.pt2\b|pygas[-_.]artifact|\btoolchain\b|\bdeployment[-_. ]?manifest\b)/i.test(value);
 if(Array.isArray(value))return value.length<=512&&value.every(item=>noDeploymentDeclaration(item,depth+1,budget));
 if(!value||typeof value!=='object'||Object.keys(value).length>128)return false;
 return Object.entries(value).every(([key,item])=>!/(artifacts|abi|toolchain|backend|deployment|aoti|pt2|artifactformat|artifactformats|__proto__|prototype|constructor)/i.test(key.replaceAll('_','').replaceAll('-',''))&&noDeploymentDeclaration(item,depth+1,budget));
}
// A narrow correction for an optional provenance-definition path misidentified as
// a deployment manifest. IO and the authoritative projection are trusted desktop
// dependencies, never Agent-supplied callbacks or permissions.
export async function manifestDefinitionCorrection(task,prior,next,parameters,readSnapshot,controlParameters){
 try{
  const config=task?.deployment?.config,binding=task?.inputBinding;
  if(config?.target!=='local'||config.inputSource==='remote'||task.parameters?.engine!=='gpumd.sampling'||binding?.contractVersion!==2||binding.semanticStatus!=='not_run'||!binding.artifactId||typeof readSnapshot!=='function'||typeof controlParameters!=='function')return null;
  if(task.projectId!==config.projectId||prior?.project_id!==config.projectId||next?.project_id!==config.projectId||prior.engine!=='gpumd.sampling'||next.engine!==prior.engine||prior.environment_id!==config.targetId||next.environment_id!==config.targetId||binding.artifactId!==prior.id||!next.id||next.id===prior.id||!unstarted(prior)||!unstarted(next)||prior.validation?.status!=='failed'||prior.validation.message!=='Selected serialized bias does not match its manifest path and SHA256'||next.validation?.status!=='not_run')return null;
  const before=snapshots(prior),after=snapshots(next);if(!before||!after||!isDeepStrictEqual(before,after)||!isDeepStrictEqual(binding.hashes,before.map(({name,sha256})=>({name,sha256})))||!isDeepStrictEqual(prior.inputs,next.inputs))return null;
  if(!isDeepStrictEqual(controlParameters(prior.parameters),controlParameters(binding.parameters))||!isDeepStrictEqual(controlParameters(next.parameters),controlParameters(parameters)))return null;
  const old=controlParameters(binding.parameters),current=controlParameters(parameters);
  if(typeof old.manifest_file!=='string'||typeof old.bias?.manifest_file!=='string'||own(current,'manifest_file')||own(current.bias,'manifest_file'))return null;
  const manifest=before.find(row=>row.name===old.manifest_file);if(!manifest||!manifest.name.endsWith('.json')||old.bias.manifest_file!==manifest.source||humanManifestChoice(task,manifest))return null;
  const removed=structuredClone(old);delete removed.manifest_file;delete removed.bias.manifest_file;if(!isDeepStrictEqual(removed,current))return null;
  const model=before.find(row=>row.name===current.bias_file);if(!model||!model.name.endsWith('.pt')||current.bias?.file!==model.source||before.filter(row=>/\.pt2?$/i.test(row.name)).length!==1||current.bias?.artifact_format!==undefined&&current.bias.artifact_format!=='torchscript')return null;
  // Explicit backend/toolchain/PT2 choices in task controls are never corrected.
  const formatProbe=structuredClone(current);if(formatProbe.bias)delete formatProbe.bias.artifact_format;
  if(!noDeploymentDeclaration(formatProbe))return null;
  const result=await readSnapshot(prior.id,manifest.name);
  if(!result||result.name!==manifest.name||result.sha256!==manifest.sha256||result.size!==manifest.size||result.size>65536||result.editable!==true||result.truncated||result.binary||typeof result.text!=='string'||Buffer.from(result.text,'utf8').toString('utf8')!==result.text||result.text.includes('\0')||Buffer.byteLength(result.text,'utf8')!==result.size||createHash('sha256').update(result.text,'utf8').digest('hex')!==manifest.sha256)return null;
  const definition=JSON.parse(result.text);
  if(!definition||Array.isArray(definition)||typeof definition.schema!=='string'||!definition.schema||definition.schema.length>256||/manifest|deployment/i.test(definition.schema)||!noDeploymentDeclaration(definition))return null;
  const artifact=definition.artifact;if(!artifact||Array.isArray(artifact)||typeof artifact!=='object'||Object.keys(artifact).length!==2||!own(artifact,'sha256')||!(own(artifact,'file')!==own(artifact,'path'))||artifact.sha256!==model.sha256)return null;
  const declared=artifact.file??artifact.path;if(declared!==model.name&&declared!==model.source)return null;
  return {kind:'unstarted-optional-manifest-definition',previousArtifactId:prior.id,sameSnapshots:true,definitionSnapshot:{name:manifest.name,sha256:manifest.sha256},droppedFields:['bias.manifest_file','manifest_file'],scope:'Single TorchScript provenance definition is not a deployment manifest; source inputs unchanged. Full validation and human execution remain required.'};
 }catch{return null;}
}
