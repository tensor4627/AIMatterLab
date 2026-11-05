import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {ScientificSkills} from "../../agent/skills/scientific-skills.mjs";import {toolValueResult} from "../../agent/tools/tool-failure.mjs";
const skillId='studio-opes-analysis',reference='references/cli-contract.json',documentId=skillId+'/'+reference,sha=value=>createHash('sha256').update(value).digest('hex');
const map=JSON.parse(await fs.readFile(new URL("../../agent/skills/scientific-skill-map.json",import.meta.url),'utf8')),documentBody=await fs.readFile(new URL("../../agent/builtin-skills/"+documentId,import.meta.url),'utf8'),document=JSON.parse(documentBody);
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-opes-public-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const registered=path.join(root,'registered','pygas'),studio=path.join(root,'public','studio'),doc=structuredClone(document);let granted=true;
 for(const item of doc.source_receipt.local_files){const target=path.join(registered,item.path),body='PRIVATE_SOURCE_BODY_MUST_NOT_BE_DELIVERED '+item.path;await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body);item.sha256=sha(body);}
 let verbatimBody=documentBody;for(let i=0;i<doc.source_receipt.local_files.length;i++)verbatimBody=verbatimBody.replace(document.source_receipt.local_files[i].sha256,doc.source_receipt.local_files[i].sha256);const route=map.functions.find(row=>row.id==='analysis.opes');for(const id of route.skills){const def=map.skills.find(row=>row.id===id),base=def.source==='studio'?studio:path.join(registered,'agents','skills');for(const file of [...def.files,...route.reference_files?.[id]||[]]){const target=path.join(base,def.folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,id===skillId&&file===reference?verbatimBody:'# Public guidance fixture '+id);}}
 const service=new ScientificSkills({map,bundledRoot:studio,studioRoot:root,sources:()=>[{id:'pygas',root:registered}],settings:()=>({pygasSkillProviders:granted?['codex','kimi','qwen','deepseek']:[]})});return{root,registered,studio,doc,service,revoke:()=>{granted=false;}};
}
const read=(f,provider='codex')=>f.service.call('read_scientific_skill',{function_id:'analysis.opes',document_id:documentId},{provider});
test('only OPES analysis adds this companion; legacy pyGAS source/consent and all other routes remain',()=>{
 const route=map.functions.find(row=>row.id==='analysis.opes');assert(route.skills.includes('pygas-opes'));assert.deepEqual(map.functions.filter(row=>row.skills.includes(skillId)).map(row=>row.id),['analysis.opes']);assert.deepEqual(route.reference_files[skillId],[reference]);assert.deepEqual(map.skills.find(row=>row.id==='pygas-opes').files,['SKILL.md','references/opes-contract.md']);
});
test('real scientific skill facade advertises and returns one full source-matched body <=16KiB for four providers',async t=>{
 const f=await fixture(t);for(const provider of ['codex','kimi','qwen','deepseek']){
  const full=await f.service.call('read_scientific_skill',{function_id:'analysis.opes'},{provider});assert.equal(full.status,'passed');assert(full.document_ids.includes(documentId));
  const result=await read(f,provider),wire=JSON.stringify(toolValueResult(result)),decoded=JSON.parse(JSON.parse(wire).content[0].text);assert.equal(decoded.status,'passed');assert.equal(decoded.document_id,documentId);assert.deepEqual(JSON.parse(decoded.text),f.doc);assert.equal(decoded.attachments.length,1);assert.equal(decoded.attachments[0].sha256,sha(decoded.text));assert.equal(decoded.attachments[0].source_evidence.status,'source_matched_reference');assert(Buffer.byteLength(wire)<=16*1024,`focused wire ${Buffer.byteLength(wire)} exceeds16KiB`);t.diagnostic(provider+' complete focused serialized bytes='+Buffer.byteLength(wire));assert(!wire.includes(f.root));assert(!wire.includes('PRIVATE_SOURCE_BODY_MUST_NOT_BE_DELIVERED'));assert.equal((decoded.text.match(/"contract": "studio-pygas-opes-analysis-cli-v1"/g)||[]).length,1);
 }
});
test('focused Studio body cannot bypass revoked pyGAS consent, unknown documents or function scope',async t=>{
 const f=await fixture(t);for(const id of ['analysis.wtmetad','sampling.gpumd'])await assert.rejects(f.service.call('read_scientific_skill',{function_id:id,document_id:documentId},{provider:'codex'}),/exact document_id/);for(const id of ['../../private',documentId.replaceAll('/','%2F')])await assert.rejects(f.service.call('read_scientific_skill',{function_id:'analysis.opes',document_id:id},{provider:'codex'}),/exact document_id/);
 f.revoke();for(const provider of ['codex','kimi','qwen','deepseek']){const r=await read(f,provider);assert.equal(r.status,'permission_required');assert.deepEqual(r.attachments,[]);assert.equal(r.text,undefined);}
});
test('changed/missing registered CLI source downgrades applicability without exposing body or root',async t=>{
 const f=await fixture(t),item=f.doc.source_receipt.local_files[0],file=path.join(f.registered,item.path);await fs.appendFile(file,' changed');let r=await read(f);assert.equal(r.status,'passed');assert.equal(r.attachments[0].source_evidence.status,'reference_only');assert.equal(r.attachments[0].source_evidence.files[0].status,'stale');await fs.unlink(file);r=await read(f);assert.equal(r.attachments[0].source_evidence.files[0].status,'blocked');assert(!JSON.stringify(r).includes('PRIVATE_SOURCE_BODY_MUST_NOT_BE_DELIVERED'));assert(!JSON.stringify(r).includes(f.root));
});
test('oversize focused schema is explicitly blocked rather than silently truncated',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.studio,documentId),JSON.stringify({...f.doc,oversized:'x'.repeat(25000)}));const result=await read(f);assert.equal(result.status,'blocked');assert.match(result.reason,/24 KiB/);assert.equal(result.text,undefined);assert.deepEqual(result.attachments,[]);
});
test('public document declares complete keys, illustrative YAML, native weight/support limits and relative receipts only',()=>{
 const keys=document.fes_yaml.keys;assert.deepEqual(Object.keys(keys).filter(key=>keys[key].required),['cv_columns','temperature','bins','lower','upper']);assert.deepEqual(Object.keys(keys).filter(key=>!keys[key].required),['periodic','bias_column','extra_bias_columns','blocks']);assert.equal(keys.temperature.unit,'K');assert.equal(keys.bias_column.default,'bias');assert.deepEqual(keys.extra_bias_columns.default,[]);assert.equal(keys.blocks.default,4);assert.equal(keys.periodic.effective_default,'all false');assert(!Object.hasOwn(keys,'logweight_column'));assert.match(document.fes_yaml.unsupported_override,/NOT read/);for(const key of Object.keys(keys))assert(document.fes_yaml.example_yaml.includes(key+':'));assert.match(document.fes_yaml.example_purpose,/not inferred defaults/);assert.match(document.weights.formula,/bias_column.*extra_bias_columns/);assert.match(document.weights.native_equivalence,/constant shift/);assert.match(document.weights.not_wtmetad,/Do NOT subtract rct/);assert.match(document.blocks_semantics.blocks2,/not standard error/);assert.match(document.grid_and_support.empty_bins,/\+inf/);assert.match(document.grid_and_support.histogram,/out-of-range/);assert.match(document.grid_and_support.dimension,/one or two/);assert.deepEqual(document.studio_binding.required_input_names,['OPES_COLVAR','fes.yaml']);
 const raw=JSON.stringify(document);assert(!/[A-Za-z]:[\\/]|\/home\/|\/mnt\/|button-audit|BEGIN .*PRIVATE KEY|127\.0\.0\.1/.test(raw));for(const item of document.source_receipt.local_files){assert.equal(item.source_id,'pygas');assert(!path.posix.isAbsolute(item.path));assert(!item.path.split('/').includes('..'));assert.match(item.sha256,/^[a-f0-9]{64}$/);}assert.equal(document.source_receipt.local_files.length,3);
});
// Optional registered-source proof uses stdlib AST + actual CLI functions with
// in-memory spies; it executes no analysis, plotting, shell, import of engine,
// model, GPU or scientific run. Source path is supplied only by the test caller.
const sourceRoot=process.env.STUDIO_TEST_PYGAS_SOURCE;
test('actual declared public CLI mapping/parser, native weighting expression and prefix/empty-bin contract',{skip:!sourceRoot,timeout:10000},()=>{
 const script=String.raw`
import ast,argparse,json,pathlib,sys,types,math,hashlib,contextlib,io
root=pathlib.Path(sys.argv[1]);doc=json.loads(sys.argv[2]);cli=(root/'entrypoints/cli.py').read_text(encoding='utf8');analysis=(root/'base/opes_analysis.py').read_text(encoding='utf8');opes=(root/'base/opes.py').read_text(encoding='utf8')
for item in doc['source_receipt']['local_files']:
 assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256']
tree=ast.parse(cli);func=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='_run_opes_reweight');parser=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='build_parser')
required=set();optional={}
for n in ast.walk(func):
 if isinstance(n,ast.Subscript) and isinstance(n.value,ast.Name) and n.value.id=='cfg' and isinstance(n.slice,ast.Constant):required.add(n.slice.value)
 if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='cfg' and n.func.attr=='get':optional[ast.literal_eval(n.args[0])]=ast.literal_eval(n.args[1])
assert required=={k for k,v in doc['fes_yaml']['keys'].items() if v['required']}
assert optional=={k:v['default'] for k,v in doc['fes_yaml']['keys'].items() if not v['required']}
seen={};current={};summary={};fake=types.ModuleType('base.opes_analysis')
def reweight(log,**kwargs):
 seen.update(kwargs);return types.SimpleNamespace(effective_sample_size=2.0,log_weights=types.SimpleNamespace(size=4),finite_bins=2,total_bins=32,block_rmse=types.SimpleNamespace(tolist=lambda:[0.0]))
fake.read_opes_log=lambda p:seen.update(log=p) or object();fake.reweight_opes_fes=reweight;fake.save_opes_fes=lambda result,**kw:seen.update(outputs=kw);fake.write_json=lambda p,d:summary.update(path=p,values=d)
sys.modules['base']=types.ModuleType('base');sys.modules['base.opes_analysis']=fake
env={'argparse':argparse,'_load_yaml':lambda path:dict(current)}
for x in tree.body:
 if isinstance(x,ast.FunctionDef) and x.name.startswith('_run_'):env[x.name]=lambda *a:None
exec(compile(ast.Module(body=[func,parser],type_ignores=[]),'<public-cli>','exec'),env)
a=env['build_parser']().parse_args(['opes-reweight','OPES_COLVAR','fes.yaml']);assert a.log=='OPES_COLVAR' and a.config=='fes.yaml';assert [a.fes_out,a.npz_out,a.png_out,a.summary_out]==list(doc['outputs'])[:4]
current.update(doc['fes_yaml']['example_values']);current['logweight_column']='ignored-selector'
with contextlib.redirect_stdout(io.StringIO()):assert env['_run_opes_reweight'](a)==0
assert seen['cv_columns']==current['cv_columns'] and seen['temperature']==float(current['temperature']) and seen['blocks']==2
assert seen['extra_bias_columns']==['extra_bias'] and 'logweight_column' not in seen
assert summary['values']['rct_used'] is False and summary['values']['weighting']=='exp(beta * total_instantaneous_bias)'
for key in optional:current.pop(key,None)
seen.clear()
with contextlib.redirect_stdout(io.StringIO()):env['_run_opes_reweight'](a)
for key,value in optional.items():assert seen[key]==value
for key in required:
 saved=current.pop(key)
 try:env['_run_opes_reweight'](a);raise AssertionError('missing required key accepted')
 except KeyError:pass
 finally:current[key]=saved
at=ast.parse(analysis);normal=next(x for x in at.body if isinstance(x,ast.FunctionDef) and x.name=='_normalised_log_weights')
class V(list):
 @property
 def ndim(self):return 1
 @property
 def size(self):return len(self)
 def __rmul__(self,b):return V(b*x for x in self)
 def __sub__(self,b):return V(x-b for x in self)
np=types.SimpleNamespace(ndarray=V,asarray=lambda x,**k:V(x),float64=float,isfinite=lambda x:[math.isfinite(v) for v in x],all=all,max=max)
ne={'np':np};exec(compile(ast.Module(body=[normal],type_ignores=[]),'<public-normalisation>','exec'),ne)
# Evaluate the actual native opes_logweight scalar expression, stripping only
# tensor detach/to wrappers; actual arithmetic tree is retained.
node=next(x for x in ast.walk(ast.parse(opes)) if isinstance(x,ast.Assign) and any(isinstance(t,ast.Subscript) and isinstance(t.slice,ast.Constant) and t.slice.value=='opes_logweight' for t in x.targets))
class Scalar(ast.NodeTransformer):
 def visit_Call(self,n):
  if isinstance(n.func,ast.Attribute) and n.func.attr in ('detach','to'):return self.visit(n.func.value)
  return self.generic_visit(n)
 def visit_Attribute(self,n):
  if isinstance(n.value,ast.Name) and n.value.id=='self' and n.attr=='kbt':return ast.Name(id='kbt',ctx=ast.Load())
  return self.generic_visit(n)
expr=compile(ast.fix_missing_locations(ast.Expression(Scalar().visit(node.value))),'<native-opES-expression>','eval')
kbt=8.617333262145e-5*300.0;bias=[0.0,0.1];extra=[0.0,0.05];native=[eval(expr,{},dict(bias=b,extra_bias=e,kbt=kbt)) for b,e in zip(bias,extra)]
normalised=ne['_normalised_log_weights']([b+e for b,e in zip(bias,extra)],1/kbt)
assert all(abs(x-(y-max(native)))<1e-12 for x,y in zip(normalised,native))
rw=next(x for x in at.body if isinstance(x,ast.FunctionDef) and x.name=='reweight_opes_fes');loop=next(x for x in ast.walk(rw) if isinstance(x,ast.For) and isinstance(x.target,ast.Name) and x.target.id=='block');assert ast.unparse(loop.iter)=='range(1, blocks)'
stop=next(x.value for x in loop.body if isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='stop' for t in x.targets));assert eval(compile(ast.Expression(stop),'<prefix-stop>','eval'),{},dict(max=max,samples=types.SimpleNamespace(shape=(8,1)),block=1,blocks=2))==4
assert any(isinstance(x,ast.Subscript) and isinstance(x.value,ast.Name) and x.value.id=='samples' and isinstance(x.slice,ast.Slice) and isinstance(x.slice.upper,ast.Name) and x.slice.upper.id=='stop' for x in ast.walk(loop))
hist=next(x for x in at.body if isinstance(x,ast.FunctionDef) and x.name=='_histogram_fes');assert any(isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and x.func.attr=='full_like' and any(isinstance(arg,ast.Attribute) and arg.attr=='inf' for arg in x.args) for x in ast.walk(hist))
# Actual Studio adapter branch under inert executable/validation boundaries.
worker=pathlib.Path(sys.argv[3]);contract=json.loads((worker/'engine_contracts.json').read_text())
assert contract['engines']['pygas.opes-reweight']['required_inputs']==doc['studio_binding']['required_input_names']
adapter_tree=ast.parse((worker/'tools/adapters.py').read_text());cls=next(x for x in adapter_tree.body if isinstance(x,ast.ClassDef) and x.name=='Adapter')
prepare=next(x for x in cls.body if isinstance(x,ast.FunctionDef) and x.name=='prepare');require=next(x for x in cls.body if isinstance(x,ast.FunctionDef) and x.name=='require');require.decorator_list=[]
package=types.ModuleType('fixture');package.__path__=[];sys.modules['fixture']=package
validation=types.ModuleType('fixture.derivative_selection');validation.validate_controls=lambda p,e:None;sys.modules['fixture.derivative_selection']=validation
ae={'__name__':'fixture.adapter','__package__':'fixture'};exec(compile(ast.Module(body=[require,prepare],type_ignores=[]),'<actual-studio-adapter>','exec'),ae)
owner=types.SimpleNamespace(engine='pygas.opes-reweight',require=ae['require'],executable=lambda environment,name:'<registered pygas executable>')
inputs={name:name for name in doc['studio_binding']['required_input_names']}
assert ae['prepare'](owner,{'inputs':inputs,'parameters':{}},{})==doc['studio_binding']['adapter_argv']
for name in inputs:
 try:ae['prepare'](owner,{'inputs':{k:v for k,v in inputs.items() if k!=name},'parameters':{}},{});raise AssertionError('missing input accepted')
 except ValueError:pass
print(json.dumps({'actual_cli':'passed','source_files':3,'normalised_native_weights':'equivalent','blocks2_prefix_stop_for_N8':4,'scope':'stdlib AST/CLI spies only; no numerical analysis run'}))
`;
 const result=spawnSync(process.env.PYTHON||'python',['-c',script,sourceRoot,JSON.stringify(document),fileURLToPath(new URL("../../backend/worker/studio_worker/",import.meta.url))],{encoding:'utf8',timeout:8000,windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);const proof=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));assert.equal(proof.actual_cli,'passed');assert.equal(proof.normalised_native_weights,'equivalent');
});
