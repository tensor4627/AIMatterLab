import React from 'react';import{createRoot}from'react-dom/client';import App from '@studio/App';import '@studio/style.css';import '@studio/task-flow.css';import './style.css';
const settings={distribution:'TEST ONLY',workerRoot:'/fixture/worker',workerPort:19000,codexPath:'fixture-not-executable',cwd:'/fixture',skillRoots:[],theme:'dark',language:'zh-CN',agentProvider:'codex',agentLayout:'right',projectAgents:{}};
const conversation={id:'codex:fixture-missing-thread',provider:'codex',threadId:'fixture-missing-thread',name:'TEST ONLY · 缺失流程会话',projectId:null,taskId:'fixture-missing'};
const calls:unknown[]=[];const record=(method:string,data?:unknown)=>{calls.push({at:new Date().toISOString(),method,data});sessionStorage.setItem('app-fixture-calls',JSON.stringify(calls));};
// No bridge/preload: this object is a bounded in-memory adapter for the actual App.
window.studio={onEvent:()=>()=>{},onTerminal:()=>()=>{},invoke:async(method:string,data:any)=>{record(method,data);
 if(method==='state')return{settings,threads:[],ssh:[]};
 if(method==='conversation.list')return[conversation];
 if(['conversation.groups','task.list','workflow.list','skills.catalog','ssh.existing'].includes(method))return[];
 if(method==='conversation.select'){if(data?.id!==conversation.id)throw Error('Fixture refuses another conversation');return conversation;}
 if(method==='conversation.remember')return conversation;
 if(method==='worker.status'||method==='worker.restore')return{status:'disconnected',reason:'TEST_ONLY_no_worker',checkedAt:1,...data};
 if(method==='task.read')throw Error('TEST ONLY: requested entity is absent');
 if(method==='scientific.skills')return{schema_version:1,functions:[],sharing:{},source_scope:'TEST ONLY'};
 if(method==='agent.account')return{account:null,credentialStored:false,modelAccess:'not_run'};
 if(method==='agent.tools')return{status:'not_run',count:0};
 if(method==='agent.connect')return{tools:{status:'not_run',count:0}};
 if(method==='agent.disconnect')return{};
 if(method==='agent.rpc'){if(['thread/resume','thread/read'].includes(data?.method))return{thread:{id:conversation.threadId,turns:[]},model:'TEST ONLY no inference'};if(data?.method==='model/list')return{data:[]};if(data?.method==='thread/list')return{data:[]};throw Error('Fixture refuses model/request '+data?.method);}
 if(method==='settings')return{...settings,...data};
 throw Error('Fixture refuses method '+method);
}}as any;
// Controlled initial routing only, before first mount; no React state injection.
localStorage.removeItem('studio.conversation');localStorage.setItem('studio.section','home');
createRoot(document.getElementById('root')!).render(<App/>);
