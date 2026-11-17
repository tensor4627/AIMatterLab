// A private Codex home excludes ambient AGENTS/config without copying native credentials.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {prepareIsolation,bootstrapSkills} from './codex-isolation.mjs';
import {prepareModelCeiling} from './codex-model-ceiling.mjs';

function ownedHome(root){
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('A main-owned Codex subscription root is required');
 const home=path.join(root,'subscription-home');let current=path.parse(home).root;
 for(const part of path.relative(current,home).split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Codex subscription home must be unlinked');}else fs.mkdirSync(current,{mode:0o700});}
 const identity=value=>process.platform==='win32'?value.toLowerCase():value;
 if(identity(fs.realpathSync(home))!==identity(path.resolve(home)))throw Error('Codex subscription home identity changed');
 return home;
}
export function createCodexSubscriptionRuntime({root,runtime,sourceHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}){
 const home=ownedHome(root),disabled=path.join(home,'native-login-disabled');let importedAccount=null;
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
  prepareIsolation:(file,isolationRoot,config,worker,dependencies={})=>prepareIsolation(file,isolationRoot,config,worker,{...dependencies,execute,probe:dependencies.probe||((exe,args,cwd)=>bootstrapSkills(exe,args,cwd,{spawnProcess})),prepareModels:(directory,instructions)=>prepareModelCeiling(directory,instructions,{cachePath:fs.existsSync(path.join(home,'models_cache.json'))?path.join(home,'models_cache.json'):path.join(sourceHome,'models_cache.json')})}),
  async initializeAuth(request,rememberSecret){
   importedAccount=null;
   if(fs.existsSync(disabled)&&fs.readFileSync(disabled,'utf8')==='disabled\n')return;
   // An explicit AIMatterLab login owns its own native credential store.
   if((await request('account/read',{refreshToken:false})).account)return;
   const auth=nativeAuth();if(!auth)return;rememberSecret(auth.accessToken);
   await request('account/login/start',{type:'chatgptAuthTokens',...auth});importedAccount=auth.chatgptAccountId;
  },
  refreshAuth(params,rememberSecret){
   const auth=nativeAuth();if(!auth||!importedAccount||auth.chatgptAccountId!==importedAccount||params?.previousAccountId&&params.previousAccountId!==importedAccount)throw Error('Codex 登录已变化，请明确重连；不会切换账户或重放消息。');
   rememberSecret(auth.accessToken);return auth;
  },
  accountOperation(){fs.writeFileSync(disabled,'disabled\n',{mode:0o600});importedAccount=null;}
 };
}
