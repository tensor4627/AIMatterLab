import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,deferred} from '../helpers/agent-hooks.mjs';

const question=(id='same',extra={})=>({id,header:'Choice',question:'Choose an approach',isSecret:false,options:[{label:'Option A',description:'Keep the existing data'},{label:'Option B',description:'Prepare another draft'}],...extra});
const request=(id,questions=[question()],threadId='questions')=>({provider:'codex',id,method:'item/tool/requestUserInput',params:{threadId,questions}});
const visit=node=>Array.isArray(node)?node.flatMap(visit):node&&typeof node==='object'?[node,...visit(node.props?.children)]:[];
const within=(node,testId)=>visit(node).find(child=>child.props?.['data-testid']===testId);
const allWithin=(node,testId)=>visit(node).filter(child=>child.props?.['data-testid']===testId);
const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
const panel=(h,id)=>h.find(node=>node.props?.['data-testid']==='agent-question-request'&&node.props['data-request-id']===String(id));
const input=(h,id,index=0)=>allWithin(panel(h,id),'agent-question-input')[index];
const submit=(h,id)=>within(panel(h,id),'agent-question-submit');
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
  h.emit(request('first'));h.emit(request('second'));await h.flush();assert.equal(submit(h,'first').props.disabled,true);
  const option=allWithin(panel(h,'first'),'agent-question-option')[0];assert.match(text(option),/Keep the existing data/);option.props.onClick();await h.flush();assert.equal(input(h,'first').props.value,'Option A');assert.equal(input(h,'second').props.value,'');assert.equal(allWithin(panel(h,'first'),'agent-question-option')[0].props['aria-pressed'],true);
  input(h,'second').props.onChange({target:{value:'My own answer'}});await h.flush();submit(h,'first').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data.result,{answers:{same:{answers:['Option A']}}});assert.equal(input(h,'second').props.value,'My own answer');
  submit(h,'second').props.onClick();await h.flush();assert.deepEqual(responses(h)[1].data.result,{answers:{same:{answers:['My own answer']}}});h.emit(request('third'));await h.flush();assert.equal(input(h,'third').props.value,'');
 }finally{h.unmount();}
});

test('Agent masks secret answers and clears them after success or server resolution without storage',async()=>{
 const h=await setup();try{
  h.emit(request('secret',[question('secret',{question:'Private response',isSecret:true,options:null})]));await h.flush();assert.equal(input(h,'secret').props.type,'password');assert.equal(input(h,'secret').props.autoComplete,'off');input(h,'secret').props.onChange({target:{value:'ephemeral-secret'}});await h.flush();submit(h,'secret').props.onClick();await h.flush();
  h.emit(request('secret',[question('secret',{isSecret:true})]));await h.flush();assert.equal(input(h,'secret').props.value,'');input(h,'secret').props.onChange({target:{value:'another-secret'}});await h.flush();h.emit({provider:'codex',method:'serverRequest/resolved',params:{threadId:'questions',requestId:'secret'}});await h.flush();h.emit(request('secret',[question('secret',{isSecret:true})]));await h.flush();assert.equal(input(h,'secret').props.value,'');assert(![...h.storage.values.values()].some(value=>value.includes('secret')));
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
  h.emit(request('required',[question('one'),question('two',{question:'Second answer'})]));await h.flush();const emptyClick=submit(h,'required').props.onClick;emptyClick();await h.flush();assert.equal(responses(h).length,0);
  input(h,'required',0).props.onChange({target:{value:'first'}});input(h,'required',1).props.onChange({target:{value:'   '}});await h.flush();assert.equal(submit(h,'required').props.disabled,true);submit(h,'required').props.onClick();await h.flush();assert.equal(responses(h).length,0);
  input(h,'required',1).props.onChange({target:{value:'second'}});await h.flush();assert.equal(submit(h,'required').props.disabled,false);submit(h,'required').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data.result,{answers:{one:{answers:['first']},two:{answers:['second']}}});
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
