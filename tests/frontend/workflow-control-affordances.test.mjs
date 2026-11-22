import {parameterDisplayLabel} from "../../frontend/ui/parameter-label.mjs";

import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';import ts from 'typescript';import React from 'react';import {renderToStaticMarkup as render} from 'react-dom/server';
const source=fs.readFileSync(new URL("../../frontend/features/workflows/AgentTaskPage.tsx",import.meta.url),'utf8'),ast=ts.createSourceFile('AgentTaskPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(n,p){if(p(n))return n;let result;ts.forEachChild(n,c=>{if(!result)result=find(c,p);});return result;}
const byClass=name=>find(ast,n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='className'&&a.initializer?.text===name));const header=byClass('visual-step-header');const artifacts=find(ast,n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='className'&&a.initializer?.text==='flow-artifacts'));
const icon=()=>React.createElement('svg',{'aria-hidden':true});function evalNode(node,bindings){const code=ts.transpileModule('return ('+node.getText(ast)+');',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return new Function('React',...Object.keys(bindings),code)(React,...Object.values(bindings));}
const i18n={exports:{}};new Function('module','exports','localStorage',ts.transpileModule(fs.readFileSync(new URL("../../frontend/ui/i18n.ts",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(i18n,i18n.exports,{getItem:()=>null,setItem:()=>{}});
const all=n=>Array.isArray(n)?n.flatMap(all):React.isValidElement(n)?[n,...all(n.props.children)]:[];
for(const language of ['zh-CN','en']){
 test(language+' artifact history preserves order and routes only actionable records',()=>{
  i18n.exports.setLanguage(language);
  const values=[
   {id:'w',kind:'workflow',name:'Saved workflow record'},
   {id:'shared-run',kind:'run',name:'Local run'},
   {id:'u',kind:'future-kind',name:'Future record'},
   {id:'shared-run',kind:'cluster-run',name:'Cluster run'},
   {id:'s',kind:'cluster-setup',name:'Cluster setup'},
   {id:'f',kind:'unknown'},
  ];
  const before=structuredClone(values),calls=[];
  const element=evalNode(artifacts,{
   t:i18n.exports.t,task:{artifacts:values},ArrowUpRight:icon,
   onRun:id=>calls.push(['run',id]),onCluster:id=>calls.push(['cluster',id]),onSetup:id=>calls.push(['setup',id]),
  });
  const rows=all(element).filter(node=>['tool-card','tool-card artifact-record'].includes(node.props.className));
  const label=node=>React.Children.toArray(node.props.children).filter(child=>typeof child==='string').join('');
  assert.deepEqual(rows.map(label),values.map(value=>value.name||value.kind));
  assert.equal(new Set(rows.map(node=>node.key)).size,values.length);

  const buttons=rows.filter(node=>node.type==='button');
  assert.deepEqual(buttons.map(label),['Local run','Cluster run','Cluster setup']);
  const records=rows.filter(node=>node.props.className==='tool-card artifact-record');
  assert.deepEqual(records.map(label),['Saved workflow record','Future record','unknown']);
  assert(records.every(node=>node.type==='div'&&node.props.onClick===undefined&&node.props.onKeyDown===undefined&&node.props.tabIndex===undefined&&node.props.role===undefined));
  for(const button of buttons)button.props.onClick();
  assert.deepEqual(calls,[['run','shared-run'],['cluster','shared-run'],['setup','s']]);
  assert.deepEqual(values,before);

  const html=render(element);
  assert(html.includes(i18n.exports.t('模块草稿与输入记录')));
  for(const value of values)assert(html.includes(value.name||value.kind));
  assert.equal((html.match(/<button/g)||[]).length,3);
  assert.equal((html.match(/<svg/g)||[]).length,3);
 });
 for(const missing of [false,true])test(language+' '+(missing?'missing locator stays actionable':'complete status is noninteractive accessible')+' and heading still expands',()=>{i18n.exports.setLanguage(language);let located=[],expanded;const element=evalNode(header,{parameterDisplayLabel,task:{manualEdits:{}},t:i18n.exports.t,absent:missing?[{label:'Temperature'}]:[],step:{id:'step',title:'参数',fields:[],tool:null},index:0,expanded:false,grouped:{primary:[]},fieldSummary:()=>'',locateMissing:id=>located.push(id),setOpen:fn=>{expanded=fn({});},ChevronDown:icon}),nodes=all(element),status=nodes.find(n=>n.props.className?.startsWith('step-status')),heading=nodes.find(n=>n.props.className==='visual-step-heading');assert(status.props['aria-label'].includes(i18n.exports.t(missing?'定位模块缺项':'模块参数齐全')));assert.equal(status.props.title,i18n.exports.t(missing?'点击定位第一个缺项':'参数齐全'));if(missing){assert.equal(status.type,'button');status.props.onClick();assert.deepEqual(located,['step']);assert.equal(status.props.disabled,undefined);}else{assert.equal(status.type,'span');assert.equal(status.props.role,'img');assert.equal(status.props.onClick,undefined);assert.equal(status.props.tabIndex,undefined);assert.equal(status.props.disabled,undefined);assert.equal(nodes.find(n=>n.props.className==='flow-dot ready').props['aria-hidden'],'true');}heading.props.onClick();assert.deepEqual(expanded,{step:true});const html=render(element);assert.equal((html.match(/<button/g)||[]).length,missing?2:1);assert(html.includes(missing?'flow-dot missing':'role="img"'));});
}
