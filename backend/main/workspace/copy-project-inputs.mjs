import path from 'node:path';
import {assertTaskWorker,sameWorkerBinding} from '../../../contracts/compute/task-worker-binding.mjs';

export const copyProjectInputsTool={
 name:'copy_project_inputs',
 description:'Copy exact files on the selected compute resource, including user-readable files outside the workspace, into the current workflow inputs. Pass absolute or ~/ paths discovered in the user-specified directory. Relative layout and original filenames are preserved together. Read and inspect the returned copies. The workflow draft can receive inputs before choosing a named workspace. This performs no model loading, execution, or submission.',
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
 inputSchema:{type:'object',properties:{project_id:{type:'string'},sources:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:{type:'string',maxLength:4096}}},required:['project_id','sources'],additionalProperties:false},
};

function absoluteFile(value){
 return typeof value==='string'&&value.length<=4096&&value.startsWith('/')&&!value.endsWith('/')&&
  !/[\\\x00-\x1f]/.test(value)&&value.split('/').slice(1).every(part=>part&&part!=='.'&&part!=='..');
}
function sourceFile(value){return typeof value==='string'&&value.length<=4096&&absoluteFile(value.startsWith('~/')?value.slice(1):value);}

export async function copyProjectInputs({worker,current},args,scope){
 const {project_id:projectId,sources}=args;
 if(Object.keys(args).some(key=>!['project_id','sources'].includes(key))||!Array.isArray(sources)||!sources.length||sources.length>64||
    !sources.every(sourceFile)||new Set(sources).size!==sources.length)throw Error('Select exact absolute or ~/ input files on the current compute resource');
 const connection=worker.connection,epoch=worker.connectionEpoch;
 function owned(){
  const task=current(scope),authoring=task.authoring;
  if(!connection||worker.connection!==connection||worker.connectionEpoch!==epoch||!authoring?.workerBinding||
     scope.projectId!==projectId||authoring.projectId!==projectId||authoring.inputRoot!==scope.inputRoot||
     !sameWorkerBinding(authoring.workerBinding,worker))throw Error('Restore the selected workflow and its original compute resource before copying inputs');
  assertTaskWorker(task,worker);
 }
 owned();
 let result;
 try{result=await worker.request('POST','/api/studio-workspace/copy-inputs',{project_id:projectId,sources});}
 catch(error){
  owned();
  if(error?.message==='Unknown route')throw Object.assign(Error('当前作业服务尚不支持复制工作区外的输入。请在当前计算资源上更新作业服务后重试。'),{operationNotStarted:true});
  throw error;
 }
 owned();
 if(result?.project_id!==projectId||!absoluteFile(result.directory)||path.posix.dirname(result.directory)!==scope.inputRoot||
    !/^import-[0-9a-f]{64}$/.test(path.posix.basename(result.directory))||!Array.isArray(result.files)||result.files.length!==sources.length)
  throw Error('The worker did not confirm this complete workspace input set');
 const paths=new Set();
 for(const [index,file] of result.files.entries()){
  if(file?.source!==sources[index]||file.status!=='passed'||file.mode!=='copy'||typeof file.name!=='string'||!absoluteFile(file.path)||file.path!==result.directory+'/'+file.name||
     path.posix.basename(file.path)!==path.posix.basename(file.source)||paths.has(file.path)||!Number.isSafeInteger(file.size)||
     file.size<0||!(/^[0-9a-f]{64}$/.test(file.sha256)))throw Error('An input copy does not match its requested source and workspace');
  paths.add(file.path);
 }
 return result;
}
