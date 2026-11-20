import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,deferred} from '../helpers/agent-hooks.mjs';

const question=(id='same',extra={})=>({id,header:'Choice',question:'Choose an approach',isSecret:false,isOther:true,options:[{label:'Option A (Recommended)',description:'Keep the existing data'},{label:'Option B',description:'Prepare another draft'}],...extra});
const request=(id,questions=[question()],threadId='questions')=>({provider:'codex',id,method:'item/tool/requestUserInput',params:{threadId,questions}});
const visit=node=>Array.isArray(node)?node.flatMap(visit):node&&typeof node==='object'?[node,...visit(node.props?.children)]:[];
const within=(node,testId)=>visit(node).find(child=>child.props?.['data-testid']===testId);
const allWithin=(node,testId)=>visit(node).filter(child=>child.props?.['data-testid']===testId);
const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
const panel=(h,id)=>h.find(node=>node.props?.['data-testid']==='agent-question-request'&&node.props['data-request-id']===String(id));
const input=(h,id,index=0)=>allWithin(panel(h,id),'agent-question-input')[index];
const submit=(h,id)=>within(panel(h,id),'agent-question-submit');
const choices=(h,id)=>allWithin(panel(h,id),'agent-question-option');
const choose=(h,id,index=0)=>choices(h,id)[index].props.onClick({detail:1});
const keys=(h,id,key,options={})=>{let prevented=false;panel(h,id).props.onKeyDown({key,nativeEvent:{isComposing:false},target:{tagName:'BUTTON',dataset:{choiceIndex:'0'}},currentTarget:{querySelector:()=>null},preventDefault:()=>{prevented=true;},...options});return prevented;};
const responses=h=>h.calls.filter(call=>call.method==='agent.respond');
async function setup(override){const h=agentHarness({props:{sessionSelection:{nonce:'questions',conversation:conversation('codex','questions')}},override:(method,data,standard)=>override?.(method,data,standard)??(method==='agent.respond'?{}:standard(method,data))});await h.flush();return h;}

test('Agent preserves upward reading during stream updates and resumes following explicitly',async()=>{
 const h=await setup();try{
  const calls=[],host={scrollHeight:1800,clientHeight:400,scrollTop:1400,scrollTo:options=>{calls.push(options);host.scrollTop=options.top;}};
  const scroll=()=>h.find(node=>node.props?.className==='chat-scroll');scroll().props.ref.current=host;
  h.emit({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'questions',itemId:'stream',delta:'first'}});await h.flush();assert.equal(calls.length,1);assert.equal(calls[0].behavior,'auto');
  host.scrollTop=200;scroll().props.onScroll();await h.flush();assert.match(text(h.find(node=>node.props?.['data-testid']==='agent-new-messages')),/回到底部/);
  host.scrollHeight=2200;h.emit({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'questions',itemId:'stream',delta:' more'}});await h.flush();assert.equal(calls.length,1);assert.equal(host.scrollTop,200);assert.match(text(h.find(node=>node.props?.['data-testid']==='agent-new-messages')),/有新消息/);
  h.click('agent-new-messages');await h.flush();assert.equal(host.scrollTop,2200);assert.throws(()=>h.find(node=>node.props?.['data-testid']==='agent-new-messages'));
  host.scrollHeight=2400;h.emit({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'questions',itemId:'stream',delta:' newest'}});await h.flush();assert.equal(host.scrollTop,2400);
 }finally{h.unmount();}
});

test('Agent manual send resumes following after the user scrolls up',async()=>{
 const h=await setup();try{
  const host={scrollHeight:1800,clientHeight:400,scrollTop:200,scrollTo:options=>{host.scrollTop=options.top;}};const scroll=h.find(node=>node.props?.className==='chat-scroll');scroll.props.ref.current=host;scroll.props.onScroll();await h.flush();
  h.type('An explicit new message');h.send();await h.flush();assert.equal(host.scrollTop,1800);assert.throws(()=>h.find(node=>node.props?.['data-testid']==='agent-new-messages'));
  assert.equal(h.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/start').length,1);
 }finally{h.unmount();}
});

test('Agent isolates concurrent same-id question answers, shows descriptions and supports option or free text',async()=>{
 const h=await setup();try{
  h.emit(request('first'));h.emit(request('second'));await h.flush();assert.equal(submit(h,'first'),undefined);assert.throws(()=>panel(h,'second'));
  const composer=h.find(node=>node.props?.className==='composer');assert.equal(within(composer,'agent-question-request'),panel(h,'first'));
  const [option]=choices(h,'first');assert.match(text(option),/Keep the existing data/);assert.match(text(option),/推荐/);assert.equal(option.props['data-highlighted'],true);assert.equal(option.props['aria-checked'],false);
  choose(h,'first');await h.flush();assert.deepEqual(responses(h)[0].data.result,{answers:{same:{answers:['Option A (Recommended)']}}});assert.equal(input(h,'second').props.value,'');
  input(h,'second').props.onChange({target:{value:'My own answer'}});await h.flush();assert.equal(input(h,'second').props.value,'My own answer');
  submit(h,'second').props.onClick();await h.flush();assert.deepEqual(responses(h)[1].data.result,{answers:{same:{answers:['My own answer']}}});h.emit(request('third'));await h.flush();assert.equal(input(h,'third').props.value,'');
 }finally{h.unmount();}
});

test('Agent masks secret answers and clears them after success or server resolution without storage',async()=>{
 const h=await setup();try{
  h.emit(request('secret',[question('secret',{question:'Private response',isSecret:true,options:null})]));await h.flush();assert.equal(input(h,'secret').props.type,'password');assert.equal(input(h,'secret').props.autoComplete,'off');input(h,'secret').props.onChange({target:{value:'ephemeral-secret'}});await h.flush();submit(h,'secret').props.onClick();await h.flush();
  h.emit(request('secret',[question('secret',{isSecret:true})]));await h.flush();assert.equal(input(h,'secret').props.value,'');input(h,'secret').props.onChange({target:{value:'another-secret'}});await h.flush();h.emit({provider:'codex',method:'serverRequest/resolved',params:{threadId:'questions',requestId:'secret'}});await h.flush();h.emit(request('secret',[question('secret',{isSecret:true})]));await h.flush();assert.equal(input(h,'secret').props.value,'');assert(![...h.storage.values.values()].some(value=>value.includes('secret')));
 }finally{h.unmount();}
});

test('DeepSeek displays a composer question and restores the draft after cancellation',async()=>{
 const h=agentHarness({props:{sessionSelection:{nonce:'deepseek-questions',conversation:conversation('deepseek','questions')}}});
 try{
  await h.flush();h.type('Keep this draft');
  h.emit({provider:'deepseek',method:'turn/started',params:{threadId:'questions',turn:{id:'working'}}});
  h.emit({...request('deepseek-choice'),provider:'deepseek'});await h.flush();
  const composer=h.find(node=>node.props?.className==='composer');
  assert.equal(within(composer,'agent-question-request'),panel(h,'deepseek-choice'));assert(!visit(composer).some(node=>node.type==='textarea'));
  assert.match(text(composer),/等待你的回答/);assert(within(composer,'agent-stop'));
  input(h,'deepseek-choice').props.onChange({target:{value:'abandoned selection'}});
  h.emit({provider:'deepseek',method:'turn/completed',params:{threadId:'questions',turn:{id:'working',status:'cancelled'}}});await h.flush();
  assert.throws(()=>panel(h,'deepseek-choice'));assert.equal(h.find(node=>node.type==='textarea').props.value,'Keep this draft');assert.equal(responses(h).length,0);
 }finally{h.unmount();}
});

test('Agent submits one response while pending and late acknowledgement cannot remove replacement request',async()=>{
 const gate=deferred(),h=await setup((method)=>method==='agent.respond'?gate.promise:undefined);try{
  h.emit(request('reused'));await h.flush();input(h,'reused').props.onChange({target:{value:'old answer'}});await h.flush();const click=submit(h,'reused').props.onClick;click();click();await h.flush();assert.equal(responses(h).length,1);assert.equal(submit(h,'reused').props.disabled,true);
  h.emit(request('reused'));await h.flush();assert.equal(input(h,'reused').props.value,'');input(h,'reused').props.onChange({target:{value:'new answer'}});await h.flush();gate.resolve({});await h.flush();assert.equal(input(h,'reused').props.value,'new answer');assert.equal(submit(h,'reused').props.disabled,false);
 }finally{h.unmount();}
});

test('Agent retains answers for explicit retry after response failure',async()=>{
 let attempts=0;const h=await setup((method)=>{if(method==='agent.respond'){if(++attempts===1)return Promise.reject(Error('not acknowledged'));return {};}});try{
  h.emit(request('retry'));await h.flush();input(h,'retry').props.onChange({target:{value:'keep this'}});await h.flush();submit(h,'retry').props.onClick();await h.flush();assert.equal(input(h,'retry').props.value,'keep this');assert.equal(submit(h,'retry').props.disabled,false);assert.deepEqual(h.errors,['Error: not acknowledged']);submit(h,'retry').props.onClick();await h.flush();assert.equal(responses(h).length,2);assert.throws(()=>panel(h,'retry'));
 }finally{h.unmount();}
});

test('Agent old response failure cannot report an error or affect a newly selected conversation',async()=>{
 const gate=deferred(),h=await setup(method=>method==='agent.respond'?gate.promise:undefined);try{
  h.emit(request('old'));await h.flush();input(h,'old').props.onChange({target:{value:'old'}});await h.flush();submit(h,'old').props.onClick();await h.flush();h.render({sessionSelection:{nonce:'new-owner',conversation:conversation('codex','new-owner')}});await h.flush();h.emit(request('old',[question()],'new-owner'));await h.flush();assert.equal(input(h,'old').props.value,'');gate.reject(Error('old error'));await h.flush();assert.deepEqual(h.errors,[]);assert.equal(input(h,'old').props.value,'');
 }finally{h.unmount();}
});

test('Agent cannot answer a stale displayed request during the same-render selection transition',async()=>{
 const h=await setup();try{
  h.emit(request('old-owner'));await h.flush();input(h,'old-owner').props.onChange({target:{value:'answer for original owner'}});await h.flush();const oldClick=submit(h,'old-owner').props.onClick;
  h.render({sessionSelection:{nonce:'switch-pending',new:true,pending:true}});oldClick();await h.flush();assert.equal(responses(h).length,0);
 }finally{h.unmount();}
});

test('Agent requires each answer before submit and never dispatches a captured empty-answer callback',async()=>{
 const h=await setup();try{
  h.emit(request('required',[question('one'),question('two',{question:'Second answer'})]));await h.flush();assert.equal(submit(h,'required'),undefined);
  const firstClick=choices(h,'required')[0].props.onClick,staleEdit=input(h,'required').props.onChange;
  input(h,'required').props.onChange({target:{value:'first'}});await h.flush();submit(h,'required').props.onClick();
  firstClick({detail:1});staleEdit({target:{value:'stale'}});await h.flush();assert.equal(responses(h).length,0);assert.equal(input(h,'required').props.value,'');assert.equal(text(within(panel(h,'required'),'agent-question-count')),'2 / 2');
  input(h,'required').props.onChange({target:{value:'   '}});await h.flush();assert.equal(submit(h,'required'),undefined);
  input(h,'required').props.onChange({target:{value:'second'}});await h.flush();assert.equal(submit(h,'required').props.disabled,false);submit(h,'required').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data.result,{answers:{one:{answers:['first']},two:{answers:['second']}}});
 }finally{h.unmount();}
});

test('Agent question keyboard supports navigation, direct answers, IME, and optional skip',async()=>{
 const h=await setup();try{
  h.emit(request('keys',[question('one'),question('two',{options:null,isOther:false}),question('three',{optional:true})]));await h.flush();
  assert.equal(keys(h,'keys','ArrowDown'),true);await h.flush();assert.equal(choices(h,'keys')[1].props['data-highlighted'],true);
  assert.equal(keys(h,'keys','Enter'),true);await h.flush();assert.equal(text(within(panel(h,'keys'),'agent-question-count')),'2 / 3');
  input(h,'keys').props.onChange({target:{value:'普通输入'}});await h.flush();
  assert.equal(keys(h,'keys','ArrowLeft',{target:{tagName:'INPUT'}}),false);
  assert.equal(keys(h,'keys','Enter',{target:{tagName:'INPUT'},nativeEvent:{isComposing:true}}),false);
  assert.equal(keys(h,'keys','Enter',{target:{tagName:'INPUT'}}),true);await h.flush();assert.equal(text(within(panel(h,'keys'),'agent-question-count')),'3 / 3');
  assert.equal(keys(h,'keys','ArrowLeft'),true);await h.flush();assert.equal(input(h,'keys').props.value,'普通输入');
  assert.equal(keys(h,'keys','ArrowRight'),true);await h.flush();within(panel(h,'keys'),'agent-question-skip').props.onClick();await h.flush();
  assert.deepEqual(responses(h)[0].data.result,{answers:{one:{answers:['Option B']},two:{answers:['普通输入']}}});
  h.emit(request('number'));await h.flush();assert.equal(keys(h,'number','1'),true);await h.flush();assert.deepEqual(responses(h).at(-1).data.result,{answers:{same:{answers:['Option A (Recommended)']}}});
 }finally{h.unmount();}
});

test('Agent restores the active question and its prior choice from the original conversation receipt',async()=>{
 const original=request('restore',[question('one'),question('two',{options:null})]);let observing=false;
 const h=await setup((method,data)=>{
  if(observing&&method==='agent.rpc'&&data.method==='thread/read'&&data.params.threadId==='questions')return {thread:{id:'questions',turns:[]},studioSession:{threadId:'questions',busy:true,turnId:'original',requests:[structuredClone(original)]}};
 });try{
  h.emit(original);await h.flush();choose(h,'restore',1);await h.flush();input(h,'restore').props.onChange({target:{value:'kept in memory'}});await h.flush();
  h.render({sessionSelection:{nonce:'other',conversation:conversation('codex','other')}});await h.flush();assert.throws(()=>panel(h,'restore'));
  observing=true;h.render({sessionSelection:{nonce:'restored',conversation:conversation('codex','questions')}});await h.flush();
  assert.equal(input(h,'restore').props.value,'kept in memory');submit(h,'restore').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data.result,{answers:{one:{answers:['Option B']},two:{answers:['kept in memory']}}});
 }finally{h.unmount();}
});

test('missing workflow tool appears in the composer and only dispatches the selected local action',async()=>{
 const h=await setup(),answers=[];
 try{
  h.type('Preserve this editable draft');
  const question={id:'missing-tool',provider:'codex',threadId:'questions',tool:'private.demo',onAnswer:action=>answers.push(action)};
  h.render({missingWorkflowToolQuestion:question});await h.flush();
  const local=h.find(node=>node.props?.['data-testid']==='agent-missing-tool-question');
  assert.match(text(local),/private\.demo/);assert.equal(allWithin(local,'agent-question-option').length,2);assert.deepEqual(answers,[]);
  const click=choices(h,'missing-tool')[1].props.onClick;click({detail:1});click({detail:1});
  assert.deepEqual(answers,['later']);assert.deepEqual(responses(h),[]);
  h.render({missingWorkflowToolQuestion:undefined});await h.flush();assert.equal(h.textarea().props.value,'Preserve this editable draft');
  h.render({missingWorkflowToolQuestion:{...question,id:'stale-setup'}});const staleAction=choices(h,'stale-setup')[0].props.onClick;
  h.render({sessionSelection:{nonce:'other-owner',conversation:conversation('codex','other-owner')}});staleAction({detail:1});await h.flush();
  assert.deepEqual(answers,['later']);assert.throws(()=>panel(h,'stale-setup'));
 }finally{h.unmount();}
});

test('acknowledged saved chat retains local workspace and tool choices while its provider is offline',async()=>{
 const saved=conversation('kimi','offline-workflow'),answers=[];
 let current=true;
 const question={id:'offline-tool',provider:saved.provider,threadId:saved.threadId,tool:'private.demo',onAnswer:action=>answers.push(action)};
 const h=agentHarness({props:{sessionSelection:{nonce:'saved',conversation:saved},selectedLocalConversation:saved,isLocalConversationCurrent:()=>current,workspaceProfileId:'saved-resource',missingWorkflowToolQuestion:question},override:(method,data,standard)=>{
  if(method==='agent.connect')throw Error('Fixture model provider offline');
  return standard(method,data);
 }});
 try{
  await h.flush();
  assert.deepEqual(h.conversations,[],'failed provider recovery preserves the desktop selection');
  const workspace=h.find(node=>node.type==='./SessionWorkspace');
  assert.equal(workspace.props.profileId,'saved-resource');
  assert.equal(workspace.props.isCurrent(),true);
  assert.match(text(panel(h,question.id)),/private\.demo/);
  const oldChoice=choices(h,question.id)[0].props.onClick;
  current=false;oldChoice({detail:1});assert.equal(workspace.props.isCurrent(),false);assert.deepEqual(answers,[]);
  current=true;choices(h,question.id)[1].props.onClick({detail:1});assert.deepEqual(answers,['later']);
  h.render({selectedLocalConversation:conversation('kimi','another-workflow'),sessionSelection:{nonce:'switching',pending:true}});
  oldChoice({detail:1});await h.flush();
  assert.throws(()=>h.find(node=>node.type==='./SessionWorkspace'));
  assert.throws(()=>panel(h,question.id));assert.equal(workspace.props.isCurrent(),false);assert.deepEqual(answers,['later']);
  assert(!h.calls.some(call=>call.method==='agent.respond'||call.method==='agent.rpc'&&call.data.method==='turn/start'));
 }finally{h.unmount();}
});

for(const change of ['resolved','replaced'])test('Agent invalidates '+change+' requests before the next render',async()=>{
 const h=await setup();try{
  h.emit(request('racing'));await h.flush();input(h,'racing').props.onChange({target:{value:'old answer'}});await h.flush();const oldClick=submit(h,'racing').props.onClick,oldEdit=input(h,'racing').props.onChange;
  if(change==='resolved')h.emit({provider:'codex',method:'serverRequest/resolved',params:{threadId:'questions',requestId:'racing'}});else h.emit(request('racing'));
  // These callbacks belong to the still-displayed old DOM before React commits.
  oldClick();oldEdit({target:{value:'stale secret'}});await h.flush();assert.equal(responses(h).length,0);
  if(change==='resolved'){assert.throws(()=>panel(h,'racing'));h.emit(request('racing'));await h.flush();}
  assert.equal(input(h,'racing').props.value,'');
 }finally{h.unmount();}
});
