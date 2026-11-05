import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
test('actual structure builder retains recipe and full source while compacting generated result and assumptions',async()=>{
 const hooks=[],calls=[],errors=[];let cursor=0,tree;
 const jsx=(type,props)=>({type,props}),useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:initial};return [hooks[i].value,v=>hooks[i].value=typeof v==='function'?v(hooks[i].value):v];};
 const result={path:'/owned/workspace/structures/generated.xyz',formula:'Ag4',n_atoms:4,provenance:{version:'fixture-ase',assumptions:[{field:'a',source:'ASE reference'}]}};
 const require=name=>name==='react'?{useState}:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==="../../api/worker"?{api:async(...args)=>{calls.push(args);return result;}}:name==="../../ui/i18n"?{t:x=>x}:name==="../../ui/Tooltip"?{default:'Tooltip'}:{Structure:'Structure'};
 const compiled=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/assets/StructureBuilder.tsx",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 new Function('require','module','exports',compiled)(require,module,module.exports);
 const props={projectId:'owned',environments:[{id:'registered',name:'Registered'}],onSaved(){},onError:e=>errors.push(e)};
 const render=()=>{cursor=0;tree=module.exports.default(props);};const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
 render();all(tree).find(n=>n.props?.['aria-label']==='检查环境').props.onChange({target:{value:'registered'}});render();
 all(tree).find(n=>n.type==='input'&&n.props.value==='Cu').props.onChange({target:{value:'Ag'}});render();
 all(tree).find(n=>n.type==='button').props.onClick();await new Promise(r=>setImmediate(r));render();
 assert.deepEqual(calls,[['POST','/api/structures/create',{project_id:'owned',environment_id:'registered',recipe:{kind:'bulk',name:'Ag',repeat:[1,1,1]}}]]);
 assert.equal(errors.length,0);const nodes=all(tree),summary=nodes.find(n=>n.props?.className==='structure-result-summary');assert.match(text(summary),/generated.xyz.*Ag4.*4 atoms.*fixture-ase/);assert(!text(summary).includes('/owned/'));
 assert(nodes.some(n=>n.type==='Tooltip'&&n.props.content===result.path));const assumptions=nodes.find(n=>n.type==='details');assert(assumptions);assert.equal(assumptions.props.open,undefined);assert.match(text(assumptions),/a: ASE reference/);
 assert(nodes.some(n=>n.type==='Tooltip'&&n.props.content.includes('尚未进行能量松弛')));
});
