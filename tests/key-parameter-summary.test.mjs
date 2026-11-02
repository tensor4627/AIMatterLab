import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parameterValue,fieldMissing} from '../shared/task-fields.mjs';

const source=fs.readFileSync(new URL('../src/AgentTaskPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('AgentTaskPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let summary,card;
function walk(n){
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='fieldSummary')summary=n.getText(ast);
 if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='data-testid'&&a.initializer?.text==='workflow-key-parameters'))card=n.getText(ast);
 ts.forEachChild(n,walk);
}walk(ast);
const compile=text=>ts.transpileModule(text,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(value,type='list'){
 const parameters={cv:{atoms:value}},before=structuredClone(parameters),field={key:'cv.atoms',label:'Atoms',type},calls=[];
 const fieldSummary=new Function('parameters','parameterValue','t',compile(summary)+';return fieldSummary;')(parameters,parameterValue,x=>x);
 const element=new Function('React','overviewFields','parameters','fieldMissing','fieldSummary','locateField','t',compile('return ('+card+');'))(React,[{step:{id:'cv-step'},field}],parameters,fieldMissing,fieldSummary,(...args)=>calls.push(args),x=>x);
 return {parameters,before,field,fieldSummary,element,calls,html:renderToStaticMarkup(element)};
}
function buttons(node){if(!node||typeof node!=='object')return [];return [...(node.type==='button'?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(buttons)];}

test('actual key-parameter card compresses ordered Ag32 atom group and still locates original field without mutation',()=>{
 const f=fixture(Array.from({length:32},(_,i)=>i));assert.match(f.html,/32 项 · 0–31/);assert(f.fieldSummary(f.field).length<40);
 buttons(f.element)[0].props.onClick();assert.deepEqual(f.calls,[['cv-step','cv.atoms']]);assert.deepEqual(f.parameters,f.before);
});
test('noncontiguous, descending and long scalar lists retain original preview order and bounded text',()=>{
 for(const values of [[7,1,8,3,20,2,9],[9,8,7,6,5,4,3],Array(8).fill('x'.repeat(1000))]){
  const f=fixture(values),text=f.fieldSummary(f.field);assert(text.length<120);assert.doesNotMatch(text,/–/);assert.deepEqual(f.parameters,f.before);
 }
 assert.match(fixture([7,1,8,3,20,2,9]).html,/7 项 · 7, 1, 8/);
 assert.equal(fixture([3,1,2]).fieldSummary({key:'cv.atoms',type:'list'}),'3, 1, 2');
});
test('matrix and ragged nested values use dimensions or row count; file summaries keep basenames',()=>{
 const matrix=fixture([[8.18,0,0],[0,8.18,0],[0,0,8.18]]);assert.equal(matrix.fieldSummary(matrix.field),'3 × 3');assert.doesNotMatch(matrix.html,/8\.18/);assert.deepEqual(matrix.parameters,matrix.before);
 const ragged=fixture([[1],[2,3]]);assert.match(ragged.fieldSummary(ragged.field),/^2 /);
 const files=fixture(['/owned/a.xyz','/owned/b.xyz','/owned/c.xyz'],'files');assert.equal(files.fieldSummary(files.field),'3 个文件 · a.xyz, b.xyz…');assert.deepEqual(files.parameters,files.before);
});
