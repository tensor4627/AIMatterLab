// A private Codex home excludes ambient AGENTS/config without copying native credentials.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {prepareIsolation,bootstrapSkills} from './codex-isolation.mjs';
import {prepareModelCeiling} from './codex-model-ceiling.mjs';
import {agentEnvironment} from './agent-environment.mjs';

function ownedHome(root){
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('A main-owned Codex subscription root is required');
 const home=path.join(root,'subscription-home');let current=path.parse(home).root;
 for(const part of path.relative(current,home).split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Codex subscription home must be unlinked');}else fs.mkdirSync(current,{mode:0o700});}
 const identity=value=>process.platform==='win32'?value.toLowerCase():value;
 if(identity(fs.realpathSync(home))!==identity(path.resolve(home)))throw Error('Codex subscription home identity changed');
 return home;
}
// Persist the attempt, including missing/failed sources: startup is not an env sync.
export function initializeSubscriptionEnv(home,sourceHome,{report=console.log,files=fs}={}){
 const target=path.join(home,'.env'),marker=path.join(home,'.env-initialized');
 const manual=`如需此配置，请自行复制到 ${target}。`;
 try{files.writeFileSync(marker,'1\n',{flag:'wx',mode:0o600});}
 catch(error){if(error.code==='EEXIST')return;report(`[Codex] .env 初始化失败（${error.code||'unknown'}）；${manual}`);return;}
 try{files.lstatSync(target);return;}catch(error){if(error.code!=='ENOENT'){report(`[Codex] .env 复制失败（${error.code||'unknown'}）；${manual}`);return;}}
 const source=path.join(sourceHome,'.env');
 try{files.statSync(source);}catch(error){
  report(error.code==='ENOENT'?`[Codex] 未找到本地 Codex .env；${manual}`:`[Codex] .env 复制失败（${error.code||'unknown'}）；${manual}`);return;
 }
 try{files.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);report(`[Codex] 已复制 .env 到 ${target}。`);}
 catch(error){if(error.code==='EEXIST')return;report(`[Codex] .env 复制失败（${error.code||'unknown'}）；${manual}`);}
}
export function createCodexSubscriptionRuntime({root,runtime,sourceHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}){
 const home=ownedHome(root);initializeSubscriptionEnv(home,sourceHome);
 const disabled=path.join(home,'native-login-disabled');let importedAccount=null;
 const catalogPath=()=>fs.existsSync(path.join(home,'models_cache.json'))?path.join(home,'models_cache.json'):path.join(sourceHome,'models_cache.json');
 let listedCatalog=null;
 const environment=options=>({...options,env:{...options?.env,CODEX_HOME:home}});
 const execute=(file,args,options)=>runtime.execute(file,args,environment(options));
 const spawnProcess=(file,args,options)=>runtime.spawnProcess(file,args,environment(options));
 function nativeAuth(){
  const file=path.join(sourceHome,'auth.json');let value,fd;
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>128*1024)throw Error();fd=fs.openSync(file,'r');const before=fs.fstatSync(fd);if(before.ino!==stat.ino||before.size!==stat.size||before.nlink!==1)throw Error();const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),current=fs.lstatSync(file);if(bytes.length!==before.size||after.mtimeMs!==before.mtimeMs||after.size!==before.size||current.ino!==before.ino||current.isSymbolicLink())throw Error();value=JSON.parse(bytes.toString('utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('无法安全读取已有 Codex 登录，请在账号页重新登录。');}finally{if(fd!==undefined)fs.closeSync(fd);}
  if(value.auth_mode!=='chatgpt')return null;
  const {access_token:accessToken,account_id:chatgptAccountId}=value.tokens||{};
  if(typeof accessToken!=='string'||!accessToken||typeof chatgptAccountId!=='string'||!chatgptAccountId)throw Error('已有 Codex 登录不完整，请在官方 Codex 刷新登录后重连。');
  return {accessToken,chatgptAccountId,chatgptPlanType:null};
 }
 return {...runtime,execute,spawnProcess,
  needsModelCatalog:()=>!fs.existsSync(catalogPath()),
  async readListedCatalog(file,listed,cwd,assertCurrent){
   // API-key sign-in can list models without writing a native models_cache.json.
   // Match only IDs observed from this account to metadata from the selected CLI.
   let models;
   try{
    const {stdout}=await execute(file,['debug','models','--bundled'],{cwd,env:agentEnvironment('codex'),windowsHide:true,timeout:15000,maxBuffer:8*1024*1024});
    models=JSON.parse(stdout).models;
   }catch{assertCurrent();throw Error('无法读取当前 Codex 的模型能力目录。请在官方 Codex 刷新模型目录后重连。');}
   assertCurrent();
   if(!Array.isArray(models)||models.length>128)throw Error('无法读取当前 Codex 的模型能力目录。');
   const selected=models.filter(model=>listed.has(model?.slug));
   if(!selected.length)throw Error('已登录，但当前 CLI 缺少所列模型的能力数据。请在官方 Codex 刷新模型目录后重连。');
   listedCatalog={file,bytes:Buffer.from(JSON.stringify({models:selected}))};
  },
  prepareIsolation:(file,isolationRoot,config,worker,dependencies={})=>prepareIsolation(file,isolationRoot,config,worker,{...dependencies,execute,probe:dependencies.probe||((exe,args,cwd)=>bootstrapSkills(exe,args,cwd,{spawnProcess})),prepareModels:(directory,instructions)=>prepareModelCeiling(directory,instructions,{cachePath:catalogPath(),missingCatalog:listedCatalog?.file===file?listedCatalog.bytes:undefined})}),
  async initializeAuth(request,rememberSecret){
   importedAccount=null;
   if(fs.existsSync(disabled)&&fs.readFileSync(disabled,'utf8')==='disabled\n')return;
   // An explicit AIMatterLab login owns its own native credential store.
   const observed=await request('account/read',{refreshToken:false});
   if(observed.account)return observed;
   const auth=nativeAuth();if(!auth)return observed;rememberSecret(auth.accessToken);
   await request('account/login/start',{type:'chatgptAuthTokens',...auth});importedAccount=auth.chatgptAccountId;
  },
  refreshAuth(params,rememberSecret){
   const auth=nativeAuth();if(!auth||!importedAccount||auth.chatgptAccountId!==importedAccount||params?.previousAccountId&&params.previousAccountId!==importedAccount)throw Error('Codex 登录已变化，请明确重连；不会切换账户或重放消息。');
   rememberSecret(auth.accessToken);return auth;
  },
  accountOperation(){fs.writeFileSync(disabled,'disabled\n',{mode:0o600});importedAccount=null;listedCatalog=null;}
 };
}
