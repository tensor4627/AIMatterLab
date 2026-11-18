import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,deferred} from '../helpers/agent-hooks.mjs';
import {elicitationHasEditableInput} from '../../frontend/features/conversations/elicitation-input.mjs';

const zero={type:'object',properties:{}};
const visit=node=>Array.isArray(node)?node.flatMap(visit):node&&typeof node==='object'?[node,...visit(node.props?.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
const event=(id,schema=zero,extra={})=>({provider:'codex',id,method:'mcpServer/elicitation/request',params:{threadId:'approvals',mode:'form',serverName:'gpusampling',message:'Approve write_shared_terminal: inspect the existing terminal',command:'printf PUBLIC_APPROVAL_FIXTURE',requestedSchema:structuredClone(schema),...extra}});
const panel=(h,id)=>h.find(node=>node.props?.['data-testid']==='agent-question-request'&&node.props['data-request-id']===String(id));
const editors=(h,id)=>visit(panel(h,id)).filter(node=>node.type==='textarea');
const action=(h,id,label)=>visit(panel(h,id)).find(node=>node.type==='button'&&node.props.children===label);
const responses=h=>h.calls.filter(call=>call.method==='agent.respond');
async function setup(override){const h=agentHarness({props:{sessionSelection:{nonce:'approvals',conversation:conversation('codex','approvals')}},override:(method,data,standard)=>method==='agent.respond'?(override?.(data)??{}):standard(method,data)});await h.flush();return h;}

test('zero-field MCP forms hide only the empty argument editor while preserving tool/command context and explicit decisions',async()=>{
 const h=await setup();try{h.emit(event('zero'));await h.flush();assert.equal(editors(h,'zero').length,0);assert.match(text(panel(h,'zero')),/write_shared_terminal/);assert.match(text(panel(h,'zero')),/printf PUBLIC_APPROVAL_FIXTURE/);assert(action(h,'zero','接受'));assert(action(h,'zero','拒绝'));assert.equal(responses(h).length,0);action(h,'zero','接受').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data,{provider:'codex',threadId:'approvals',id:'zero',result:{action:'accept',content:{}}});assert.throws(()=>panel(h,'zero'));}finally{h.unmount();}
});

test('declining a confirmation still sends decline/null without requesting terminal execution',async()=>{
 const h=await setup();try{h.emit(event('decline'));await h.flush();action(h,'decline','拒绝').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data.result,{action:'decline',content:null});assert.equal(h.calls.some(call=>call.method==='sharedTerminal.input'||call.method==='worker.request'),false);}finally{h.unmount();}
});

test('declared approval fields retain editable JSON and submit only explicitly entered content',async()=>{
 const h=await setup();try{h.emit(event('fields',{type:'object',properties:{command:{type:'string'}},required:['command']}));await h.flush();assert.equal(editors(h,'fields').length,1);assert.equal(editors(h,'fields')[0].props['aria-label'],'审批参数');editors(h,'fields')[0].props.onChange({target:{value:'{"command":"printf REVIEWED_FIXTURE"}'}});await h.flush();action(h,'fields','接受').props.onClick();await h.flush();assert.deepEqual(responses(h)[0].data.result,{action:'accept',content:{command:'printf REVIEWED_FIXTURE'}});}finally{h.unmount();}
});

test('meaningful approval JSON parse errors remain visible and never dispatch a response',async()=>{
 const h=await setup();try{h.emit(event('invalid',{type:'object',properties:{count:{type:'integer'}}}));await h.flush();editors(h,'invalid')[0].props.onChange({target:{value:'not valid JSON'}});await h.flush();action(h,'invalid','接受').props.onClick();await h.flush();assert.equal(responses(h).length,0);assert.equal(h.errors.length,1);assert.equal(editors(h,'invalid')[0].props.value,'not valid JSON');}finally{h.unmount();}
});

test('empty and editable approvals stay isolated while responses are pending and request ids are reused',async()=>{
 const gate=deferred(),h=await setup(()=>gate.promise);try{h.emit(event('zero'));h.emit(event('edit',{type:'object',properties:{text:{type:'string'}}}));await h.flush();editors(h,'edit')[0].props.onChange({target:{value:'{"text":"retained"}'}});await h.flush();const click=action(h,'zero','接受').props.onClick;click();click();await h.flush();assert.equal(responses(h).length,1);assert.equal(action(h,'zero','接受').props.disabled,true);assert.equal(editors(h,'edit')[0].props.value,'{"text":"retained"}');h.emit(event('zero',{type:'object',properties:{replacement:{type:'string'}}}));await h.flush();assert.equal(editors(h,'zero')[0].props.value,'{}');gate.resolve({});await h.flush();assert.equal(editors(h,'zero').length,1);assert.equal(action(h,'zero','接受').props.disabled,false);assert.equal(editors(h,'edit')[0].props.value,'{"text":"retained"}');}finally{h.unmount();}
});

test('resolved or switched confirmation cannot be accepted through a stale displayed callback',async()=>{
 for(const change of ['resolved','selection']){const h=await setup();try{h.emit(event('stale'));await h.flush();const click=action(h,'stale','接受').props.onClick;if(change==='resolved')h.emit({provider:'codex',method:'serverRequest/resolved',params:{threadId:'approvals',requestId:'stale'}});else h.render({sessionSelection:{nonce:'new-selection',new:true,pending:true}});click();await h.flush();assert.equal(responses(h).length,0);}finally{h.unmount();}}
});

test('only supported forms with an explicit zero-control object shape can omit input',()=>{
 for(const schema of [zero,{...zero,required:[]},{...zero,additionalProperties:false},{...zero,$schema:'https://json-schema.org/draft/2020-12/schema',title:'Confirmation',description:'Review the displayed operation'}])for(const mode of [undefined,'form'])assert.equal(elicitationHasEditableInput({requestedSchema:schema,...mode?{mode}:{}}),false);
 for(const mode of ['openai/form','openaiForm']){assert.equal(elicitationHasEditableInput({mode,requestedSchema:zero}),true);assert.equal(elicitationHasEditableInput({mode,requestedSchema:{...zero,additionalProperties:false}}),false);}
});

test('unconstrained, freeform, unknown, required, malformed and non-form schemas retain input',()=>{
 for(const schema of [undefined,null,{},true,false,[],{type:'string'}, {type:'object'}, {...zero,properties:null}, {...zero,properties:[]},{...zero,properties:{optional:{type:'string'}}},{...zero,required:['undeclared']},{...zero,required:'field'}, {...zero,additionalProperties:true},{...zero,additionalProperties:{type:'string'}},{...zero,patternProperties:{'^x':{type:'string'}}},{...zero,minProperties:1},{...zero,oneOf:[{properties:{value:{type:'string'}}}]},{...zero,allOf:[]},{...zero,if:{},then:{}},{...zero,$ref:'#/$defs/input'},{...zero,unknownFutureKeyword:true},{...zero,title:{}},{...zero,default:{input:'meaningful'}}])assert.equal(elicitationHasEditableInput({mode:'form',requestedSchema:schema}),true,JSON.stringify(schema));
 for(const mode of ['url','unknownFutureMode',null])assert.equal(elicitationHasEditableInput({mode,requestedSchema:{...zero,additionalProperties:false}}),true);assert.equal(elicitationHasEditableInput(null),true);
});

test('unconstrained schema is visibly editable even though its initial value is the same empty JSON object',async()=>{
 const h=await setup();try{h.emit(event('unconstrained',{}));await h.flush();assert.equal(editors(h,'unconstrained').length,1);assert.equal(editors(h,'unconstrained')[0].props.value,'{}');}finally{h.unmount();}
});
