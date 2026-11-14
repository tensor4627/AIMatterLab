import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const module={exports:{}},compiled=ts.transpileModule(fs.readFileSync(new URL('../../frontend/ui/i18n.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
new Function('module','exports','localStorage',compiled)(module,module.exports,{getItem:()=> 'en',setItem(){}});
const sources=['terminal/SshConnectionPanel.tsx','compute/IndependentSshServiceSettings.tsx','compute/ssh-connection-types.ts','compute/SshServiceObservation.tsx'];
for(const file of sources)test('new independent SSH UI has fixed English strings: '+file,()=>{const ast=ts.createSourceFile(file,fs.readFileSync(new URL('../../frontend/features/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),keys=new Set();function walk(node){if(ts.isStringLiteral(node)&&/[\u4e00-\u9fff]/.test(node.text))keys.add(node.text);ts.forEachChild(node,walk);}walk(ast);for(const key of keys)assert.doesNotMatch(module.exports.t(key),/[\u4e00-\u9fff]/,key);});
test('new Agent independent-channel notices remain English',()=>{for(const key of ['请先在终端完成 SSH 登录，成功后会自动进入终端。','请在“作业服务”中交给 Agent，授权当前对话使用服务；终端可分别交接。','请在“终端操作”中交给 Agent，或连接并交接作业服务。','当前对话的工具尚未就绪，请核对终端或作业服务状态。'])assert.doesNotMatch(module.exports.t(key),/[\u4e00-\u9fff]/);});
