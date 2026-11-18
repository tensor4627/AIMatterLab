import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../../../frontend/app/App.tsx';
import '../../../frontend/app/style.css';

const settings = {distribution:'Ubuntu', workerRoot:'/fixture', workerPort:8767, codexPath:'codex', cwd:'/fixture',
  skillRoots:[], theme:'dark', language:'zh-CN', agentProvider:'codex'};
const fixture = window.__test = {settings, calls:[], events:[]};

window.studio = {
  onEvent(callback) {
    fixture.events.push(callback);
    return () => { fixture.events = fixture.events.filter(item => item !== callback); };
  },
  onTerminal: () => () => {},
  async invoke(method, data) {
    fixture.calls.push({method,data});
    if (method === 'state') return {settings:fixture.settings, threads:[], ssh:[]};
    if (method === 'settings') {
      fixture.settings = {...fixture.settings,...data};
      return fixture.settings;
    }
    if (['conversation.groups','task.list','workflow.list','skills.catalog','ssh.existing'].includes(method)) return [];
    if (method === 'worker.status') return {status:'disconnected',checkedAt:1};
    if (method === 'agent.account') return {account:null,requiresOpenaiAuth:true,modelAccess:'not_run'};
    if (method === 'agent.connect') return {tools:{status:'ready',count:0}};
    if (method === 'agent.tools') return {status:'ready',count:0};
    if (method === 'agent.rpc' && ['model/list','thread/list'].includes(data.method)) return {data:[]};
    if (method === 'scientific.skills') return {schema_version:1,functions:[],sharing:{},source_scope:'Isolated native fixture'};
    if (['diagnostics.performance','agent.disconnect'].includes(method)) return {};
    throw Error('Unexpected native fixture IPC: ' + method);
  },
};

const root = createRoot(document.getElementById('root'));
window.renderTest = name => {
  if (name !== 'App') throw Error('Only the product App is present in this acceptance fixture');
  root.render(React.createElement(App));
};
