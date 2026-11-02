import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
import * as shell from '../src/workspace-shell.mjs';
test('Jobs sync tooltip uses the actual button while offline/paused observations and timestamps remain visible',()=>{
 const jsx=(type,props)=>({type,props});const module={exports:{}};
 const require=name=>name==='react'?{useState:value=>[value,()=>{}]}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./workspace-shell.mjs'?shell:name==='./i18n'?{t:x=>x}:name==='./Tooltip'?{default:'Tooltip'}:new Proxy({},{get:(_t,k)=>String(k)});
 const code=ts.transpileModule(fs.readFileSync(new URL('../src/JobsPage.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(require,module,module.exports);
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
 let refreshes=0;
 for(const connected of [false,true]){
  const tree=module.exports.default({local:[],cluster:[],observations:{local:{loaded:true,stale:true,paused:true,at:123},cluster:{loaded:false,stale:false,at:null}},projects:[],projectId:'',tasks:[],conversations:[],worker:connected,busy:false,onRefresh:()=>refreshes++,onOpen(){},onConversation(){}});
  const nodes=all(tree),tooltip=nodes.find(n=>n.type==='Tooltip');assert.equal(tooltip.props.asChild,true);
  const button=tooltip.props.children;assert.equal(button.type,'button');assert.equal(button.props.disabled,!connected);if(connected)button.props.onClick();
  assert.equal(nodes.filter(n=>n.type==='button'&&text(n)==='同步记录').length,1);assert(!nodes.some(n=>n.props?.className==='jobs-scope'));
  const observation=nodes.find(n=>n.props?.['data-testid']==='job-observation-local');assert.match(text(observation),/自动同步已暂停/);assert.match(text(observation),/记录读取时间/);
 }
 assert.equal(refreshes,1);
});
