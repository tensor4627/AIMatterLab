import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as shell from '../../frontend/app/workspace-shell.mjs';
const code=ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/runs/JobsPage.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(initial={}){
 const now=Date.now()/1000,states=[],actions=[];let cursor=0,tree;let props={local:[{id:'local-running',name:'Older local run',project_id:'other',status:'running',engine:'pydyn.md',created_at:now-60*86400},{id:'local-done',name:'Finished local run',project_id:'current',status:'succeeded',engine:'pydyn.md',created_at:now}],cluster:[{id:'cluster-queued',name:'Cluster waiting',project_id:'current',status:'queued',engine:'gpumd.md',created_at:now},{id:'cluster-unknown',name:'Unconfirmed cluster run',project_id:'current',status:'unknown',engine:'gpumd.md',created_at:now}],observations:{local:{at:now,loaded:true,stale:false},cluster:{at:now,loaded:true,stale:true}},projects:[{id:'current',name:'Current project'},{id:'other',name:'Other project'}],projectId:'current',tasks:[],conversations:[],worker:true,busy:false,onRefresh:()=>actions.push('refresh'),onOpen:job=>actions.push(['open',job.key]),onConversation:conversation=>actions.push(['conversation',conversation.id]),...initial};
 const jsx=(type,props)=>({type,props}),module={exports:{}},require=name=>name==='react'?{useState:initial=>{const i=cursor++;states[i]??={value:typeof initial==='function'?initial():initial};return [states[i].value,value=>{states[i].value=typeof value==='function'?value(states[i].value):value;}];}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='../../app/workspace-shell.mjs'?shell:name==='../../ui/i18n'?{t:value=>value}:name==='../../ui/Dialogs'?{Badge:'Badge',statusNames:{running:'运行中',queued:'排队中',unknown:'待核对',succeeded:'已完成'}}:new Proxy({default:name},{get:(object,key)=>object[key]??key});
 new Function('require','module','exports',code)(require,module,module.exports);
 const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 function render(next){if(next)props={...props,...next};cursor=0;tree=module.exports.default(props);}
 const find=fn=>{const found=all(tree).find(fn);assert(found,'fixture target exists');return found;};
 const select=label=>find(node=>node.props?.['aria-label']===label);
 const change=(label,value)=>{select(label).props.onChange({target:{value}});render();};
 const byId=id=>find(node=>node.props?.['data-testid']===id);
 const click=(id,event)=>{byId(id).props.onClick(event);render();};
 render();return {render,find,select,change,byId,click,actions,text:()=>text(tree),nodeText:text,rows:()=>all(tree).filter(node=>node.props?.className==='job-record'),props};
}
test('status cards preserve location, time, text and project filters, including an empty intersection',()=>{
 const h=harness();h.change('计算位置筛选','cluster');h.change('任务时间筛选','1');h.change('搜索任务','Cluster');h.change('任务项目筛选','current');h.click('jobs-overview-running');assert.equal(h.select('计算位置筛选').props.value,'cluster');assert.equal(h.select('任务时间筛选').props.value,'1');assert.equal(h.select('搜索任务').props.value,'Cluster');assert.equal(h.select('任务项目筛选').props.value,'current');assert.equal(h.select('任务状态筛选').props.value,'running');assert.equal(h.rows().length,0);assert.equal(h.byId('jobs-overview-running').props['aria-pressed'],true);h.click('jobs-overview-queued');assert.deepEqual(h.rows().map(node=>node.props['data-job-key']),['cluster:cluster-queued']);assert.deepEqual(h.actions,[]);
});
test('empty-result reset restores all read records and unknown remains an observed status',()=>{
 const h=harness();h.change('搜索任务','no match');assert.match(h.nodeText(h.byId('jobs-empty')),/没有匹配/);assert.match(h.nodeText(h.byId('jobs-filter-summary')),/no match/);h.find(node=>node.type==='button'&&h.nodeText(node)==='清除筛选，查看全部记录').props.onClick();h.render();assert.equal(h.rows().length,4);assert.match(h.nodeText(h.byId('jobs-filter-summary')),/未设置筛选/);h.click('jobs-overview-unknown');assert.deepEqual(h.rows().map(node=>node.props['data-job-key']),['cluster:cluster-unknown']);assert.match(h.text(),/上次记录 · 请核对原作业/);assert.equal(h.props.cluster[1].status,'unknown');assert.deepEqual(h.actions,[]);
});
test('unread selected source is distinguished from an empty filtered result and counts stay unknown',()=>{
 const h=harness({cluster:[],observations:{local:{at:123,loaded:true,stale:false},cluster:{at:null,loaded:false,stale:false}}});h.change('计算位置筛选','cluster');assert.match(h.nodeText(h.byId('jobs-empty')),/记录尚未读取完整/);assert.match(h.nodeText(h.byId('jobs-empty')),/所选来源尚未读取成功/);assert.match(h.nodeText(h.byId('jobs-overview-running')),/—/);assert.deepEqual(h.actions,[]);
});
test('planning overview expands seven collapsed flows, scrolls and focuses their summary',()=>{
 const tasks=Array.from({length:7},(_,i)=>({id:'task-'+i,name:'Planning '+i})),conversations=tasks.map(task=>({id:'conversation-'+task.id,taskId:task.id})),h=harness({tasks,conversations});const details=()=>h.find(node=>node.type==='details'&&node.props.id==='planning-overview');assert.equal(details().props.open,false);const events=[],panel={open:false,querySelector:()=>({scrollIntoView:options=>events.push(['scroll',options]),focus:options=>events.push(['focus',options])})};h.click('jobs-overview-planning',{currentTarget:{closest:()=>({querySelector:()=>panel})}});assert.equal(details().props.open,true);assert.equal(panel.open,true);assert.deepEqual(events,[['scroll',{block:'start'}],['focus',{preventScroll:true}]]);details().props.onToggle({currentTarget:{open:false}});h.render();assert.equal(details().props.open,false);h.change('搜索任务','other');assert.equal(details().props.open,false,'manual collapse survives unrelated filtering');assert.deepEqual(h.actions,[]);
});
test('planning navigation remains disabled while busy or when no conversation is bound',()=>{
 const h=harness({tasks:[{id:'task-a',name:'Plan A'},{id:'task-b',name:'Plan B'}],conversations:[{id:'conversation-a',taskId:'task-a'}],busy:true});const buttons=()=>['Plan A','Plan B'].map(label=>h.find(node=>node.type==='button'&&h.nodeText(node).startsWith(label)));assert(buttons().every(button=>button.props.disabled));h.render({busy:false});assert.equal(buttons()[0].props.disabled,false);assert.equal(buttons()[1].props.disabled,true);buttons()[0].props.onClick();assert.deepEqual(h.actions,[['conversation','conversation-a']]);
});
test('disconnected saved records remain visible but cannot issue an open request',()=>{
 const h=harness({worker:false});assert.equal(h.rows().length,4);assert.match(h.text(),/请先恢复原服务/);const button=h.find(node=>node.props?.className==='job-record-open');assert(button.props.disabled);button.props.onClick();assert.deepEqual(h.actions,[]);h.render({worker:true});const restored=h.find(node=>node.props?.className==='job-record-open');assert.equal(restored.props.disabled,false);restored.props.onClick();assert.equal(h.actions[0][0],'open');
});
