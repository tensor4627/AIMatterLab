import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {actualAuthoringWorker} from '../../../contracts/compute/task-worker-binding.mjs';

export const baseWorkspaceTool={
 name:'setup_base_workspace',
 description:'Inspect or initialize the base workspace on the currently handed-off SSH connection. Start with action inspect, reuse a configured workspace, or use ensure to create the managed default. Optional name and directory choose a named workspace within this service. Available in ordinary chat. Returns actual directory and layout. This creates an authoring workspace with no engine or job grant.',
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
 inputSchema:{type:'object',properties:{action:{type:'string',enum:['inspect','ensure']},name:{type:'string',minLength:1,maxLength:80},directory:{type:'string',pattern:'^[A-Za-z0-9_-]{1,60}$'}},required:['action'],additionalProperties:false},
};

export function createBaseWorkspace({catalog,worker,resource,service,current,emit=()=>{}}){
 const operations=new Map();
 function context(profile,scope){
  const selected=resource.peek(),state=service.peek(),connection=worker.connection,epoch=worker.connectionEpoch;
  const binding=actualAuthoringWorker(worker),owner=current();
  const key=createHash('sha256').update(JSON.stringify([binding.profileId,binding.root,binding.hostIdentity])).digest('hex');
  function check(){
   resource.assertCurrent(ticket);
   const now=service.peek();
   if(selected?.kind!=='ssh-connection'||binding.kind!=='ssh'||selected.connectionId!==worker.identity?.connectionId||
      selected.profileId!==binding.profileId||selected.profileVersion!==binding.profileVersion||
      now.status!=='connected'||!now.workflowReady||now.connectionId!==selected.connectionId||now.attemptId!==state.attemptId||
      worker.connection!==connection||worker.connectionEpoch!==epoch||!equal(binding,actualAuthoringWorker(worker))||!equal(owner,current()))
    throw Error('基础工作区的集群连接已变化，请核对当前连接');
   if(profile&&(profile.profileId!==selected.profileId||profile.profileVersion!==selected.profileVersion||profile.connectionId!==selected.connectionId))
    throw Error('请先选择此集群连接并接入作业服务');
   if(scope&&(!scope.provider||!scope.threadId||scope.checkCurrent?.()!==true||scope.provider!==owner?.provider||
      scope.threadId!==owner?.threadId||!service.hasCurrentGrant(scope.provider,scope)))throw Error('请在当前对话中交接此集群连接');
  }
  const ticket=resource.capture();check();
  const request=async(...args)=>{check();const value=await worker.request(...args);check();return value;};
  return {key,binding,check,request};
 }
 function options(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['action','name','directory'].includes(k))||
     !['inspect','ensure'].includes(args.action)||args.action==='inspect'&&(args.name!==undefined||args.directory!==undefined)||
     (args.name!==undefined)!==(args.directory!==undefined)||args.name!==undefined&&
     (typeof args.name!=='string'||!args.name.trim()||args.name.length>80||/[\x00-\x1f]/.test(args.name)||typeof args.directory!=='string'||!(/^[A-Za-z0-9_-]{1,60}$/).test(args.directory)))
   throw Error('请填写工作区名称及目录名');
 }
 async function read(ctx,id){
  const workspace=await ctx.request('POST','/api/studio-workspace/read',{project_id:id});
  if(workspace?.id!==id||workspace.root!==ctx.binding.root+'/projects/'+id+'/inputs'||!Array.isArray(workspace.directories))
   throw Error('基础工作区目录尚未核对，请重新读取');
  const projects=await ctx.request('GET','/api/projects'),project=Array.isArray(projects)?projects.find(p=>p.id===id):null;
  if(!project?.authoring_only||!project.studio_workspace)throw Error('请选择软件管理的编写工作区');
  return {id:workspace.id,name:workspace.name,root:workspace.root,directories:workspace.directories,asset_mode:workspace.asset_mode};
 }
 async function run(ctx,args){
  const saved=catalog.get('cluster-base-workspace',ctx.key);
  if(args.action==='inspect')return saved?
   {status:'ready',workspace:await read(ctx,saved.workspaceId)}:{status:'unconfigured',suggested:{name:'基础工作区',directory:'base'}};
  const name=args.name?.trim()||saved?.name||'基础工作区',directory=args.directory||saved?.directory||'base',id='workspace-'+directory;
  await ctx.request('POST','/api/studio-workspace/create',{id,name,asset_mode:'copy'});
  const workspace=await read(ctx,id);ctx.check();
  catalog.put('cluster-base-workspace',ctx.key,{workspaceId:id,name:workspace.name,directory,profileId:ctx.binding.profileId,root:ctx.binding.root,checkedAt:Date.now()});
  emit();return {status:'ready',workspace};
 }
 async function execute(args,profile,scope){
  options(args);const ctx=context(profile,scope);
  if(args.action==='inspect')return run(ctx,args);
  const signature=JSON.stringify(args),previous=operations.get(ctx.key);
  if(previous){if(previous.signature!==signature)throw Error('正在设置基础工作区，请稍候');const result=await previous.promise;ctx.check();return result;}
  const promise=run(ctx,args);operations.set(ctx.key,{signature,promise});
  try{return await promise;}finally{if(operations.get(ctx.key)?.promise===promise)operations.delete(ctx.key);}
 }
 return {
  call:(args,scope)=>execute(args,undefined,scope),
  async manual(value){
   if(!value||Object.keys(value).some(k=>!['connectionId','profileId','profileVersion','action','name','directory'].includes(k))||
      typeof value.connectionId!=='string'||typeof value.profileId!=='string'||!Number.isSafeInteger(value.profileVersion)||value.profileVersion<1)throw Error('Invalid base workspace request');
   const {connectionId,profileId,profileVersion,...args}=value;
   return execute(args,{connectionId,profileId,profileVersion});
  },
  async forTask(task,assertCurrent){
   assertCurrent();const owner=current();
   if(owner?.taskId!==task.id||owner.provider!==task.provider||owner.threadId!==task.threadId)throw Error('请先选择当前流程');
   const result=await execute({action:'ensure'});assertCurrent();
   return {...result.workspace,assets:[],workerBinding:actualAuthoringWorker(worker)};
  },
 };
}
