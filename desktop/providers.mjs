import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
export const PROVIDERS=['codex','kimi','qwen'];
export const CLI_VERSIONS={kimi:'2.1.1',qwen:'0.24.7'};
export function providerId(id){if(!PROVIDERS.includes(id))throw Error('Unsupported Agent provider');return id;}
export function cliCommand(executable,args=[]){
 if(typeof executable!=='string'||!executable.trim()||/[\r\n\0]/.test(executable))throw Error('Invalid CLI path');
 if(/\.(mjs|cjs|js)$/i.test(executable))return {file:process.execPath,args:[path.resolve(executable),...args],env:{ELECTRON_RUN_AS_NODE:'1'}};
 if(/\.(cmd|bat|ps1)$/i.test(executable))throw Error('Select the CLI .js/.mjs entry or executable, not a shell wrapper');
 return {file:executable,args,env:{}};
}
export function spawnCli(executable,args,options={}){
 const command=cliCommand(executable,args);
 return spawn(command.file,command.args,{stdio:['pipe','pipe','pipe'],windowsHide:true,...options,env:{...process.env,...options.env,...command.env}});
}
export function redact(text,secrets=[]){
 let result=String(text);for(const secret of secrets.filter(Boolean))result=result.replaceAll(secret,'[redacted]');
 return result.replace(/\bsk-[A-Za-z0-9_-]{8,}/g,'[redacted]').replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]');
}
export const QWEN_ENDPOINTS={
 'coding-cn':'https://coding.dashscope.aliyuncs.com/v1',
 'coding-intl':'https://coding-intl.dashscope.aliyuncs.com/v1',
 'api-cn':'https://dashscope.aliyuncs.com/compatible-mode/v1',
 'api-intl':'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
};
export function qwenCredentials(value){
 const baseUrl=QWEN_ENDPOINTS[value.plan];
 if(!baseUrl)throw Error('Select a supported Qwen plan and region');
 if(typeof value.apiKey!=='string'||value.apiKey.length<8||value.apiKey.length>512||/\s/.test(value.apiKey))throw Error('Invalid API key');
 if(typeof value.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value.model))throw Error('Enter a model ID');
 if(value.plan.startsWith('coding-')&&!value.apiKey.startsWith('sk-sp-'))throw Error('Coding Plan requires its sk-sp- key');
 return {baseUrl,plan:value.plan,model:value.model,apiKey:value.apiKey};
}
export class CredentialVault{
 constructor(root,encryption){this.root=root;this.encryption=encryption;fs.mkdirSync(root,{recursive:true});}
 file(id){providerId(id);return path.join(this.root,id+'.bin');}
 get(id){if(!fs.existsSync(this.file(id)))return null;if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption is unavailable');return JSON.parse(this.encryption.decryptString(fs.readFileSync(this.file(id))));}
 put(id,value){if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption is unavailable');const file=this.file(id),temp=file+'.tmp';fs.writeFileSync(temp,this.encryption.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(temp,file);}
 remove(id){if(fs.existsSync(this.file(id)))fs.unlinkSync(this.file(id));}
}
export function prepareProfile(root,id,credential){
 providerId(id);const home=path.join(root,id),cwd=path.join(home,'workspace');fs.mkdirSync(cwd,{recursive:true});
 if(id==='kimi'){
  const file=path.join(home,'config.toml');let config=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
  // Owned profile only. Keep providers created by official login; replace our policy section.
  config=config.replace(/\n# STUDIO POLICY BEGIN[\s\S]*?# STUDIO POLICY END\n?/g,'\n');
  // These tables are owned by Studio and cannot be replaced by restored session modes.
  for(const table of ['tools','permission'])config=config.replace(new RegExp('\\n\\['+table+'\\][\\s\\S]*?(?=\\n\\[|$)','g'),'\n');
  config+='\n# STUDIO POLICY BEGIN\n[tools]\nenabled = ["mcp__gpusampling__*", "AskUserQuestion"]\n[permission]\ndangerous_command_guard = true\n[[permission.rules]]\ndecision = "allow"\npattern = "mcp__gpusampling__*"\n# STUDIO POLICY END\n';
  fs.writeFileSync(file,config,{mode:0o600});
  fs.writeFileSync(path.join(home,'SYSTEM.md'),'You are GPU Sampling Studio. Use only gpusampling tools. Use present_task with the studioTaskId from context to display workflow steps, parameters and missing fields in the central task page. Prepare task drafts, ask for missing scientific parameters, then STOP for the human to review the module page and click Confirm and Execute. Never validate, submit, launch, or bypass the review gate.');
  return {cwd,home,args:['acp'],env:{KIMI_CODE_HOME:home,KIMI_API_KEY:'',KIMI_BASE_URL:''}};
 }
 const settings={security:{auth:{selectedType:'openai'}},telemetry:{enabled:false},hooks:{enabled:false},tools:{core:['ask_user_question']},general:{enableAutoUpdate:false}};
 if(credential){settings.modelProviders={openai:[{id:credential.model,name:credential.model,baseUrl:credential.baseUrl,envKey:'STUDIO_QWEN_API_KEY'}]};settings.model={name:credential.model};}
 fs.writeFileSync(path.join(home,'settings.json'),JSON.stringify(settings,null,2));
 return {cwd,home,args:['--acp','--bare','--approval-mode','default','--exclude-tools','edit,get_goal,notebook_edit,read_file,run_shell_command,update_goal,write_file,read_many_files,list_directory,glob,search_file_content,web_fetch,web_search,save_memory,task,todo_write,exit_plan_mode','--allowed-mcp-server-names','gpusampling','--append-system-prompt','You are GPU Sampling Studio. Use present_task with studioTaskId to fill the central workflow and parameter page. Prepare gpusampling task drafts and STOP for human review. Never validate, submit or execute scientific jobs.'],env:{QWEN_HOME:home,OPENAI_API_KEY:'',OPENAI_BASE_URL:'',OPENAI_MODEL:'',STUDIO_QWEN_API_KEY:'',QWEN_API_KEY:'',...credential?{OPENAI_API_KEY:credential.apiKey,STUDIO_QWEN_API_KEY:credential.apiKey,OPENAI_BASE_URL:credential.baseUrl,OPENAI_MODEL:credential.model}:{}}};
}
