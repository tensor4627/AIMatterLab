import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {providerId} from '../../agent/providers/contracts.mjs';
import {assertRpc} from '../security.mjs';
import {STUDIO_VERSION} from '../studio-version.mjs';
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
export function prepareProfile(root,id,credential){
 providerId(id);if(!['kimi','qwen'].includes(id))throw Error('This provider does not use a CLI profile');const home=path.join(root,id),cwd=path.join(home,'workspace');fs.mkdirSync(cwd,{recursive:true});
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

/** Native process/profile capabilities supplied to Agent bridge instances. */
export const providerRuntime=Object.freeze({spawnCli,prepareProfile,assertRpc,version:STUDIO_VERSION});
