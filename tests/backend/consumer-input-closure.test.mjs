import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyConsumerInputs,renderConsumerInputs} from "../../backend/main/workspace/consumer-input-closure.mjs";
const digest=value=>createHash('sha256').update(value).digest('hex'),h='a'.repeat(64),j='b'.repeat(64),privateCode='c'.repeat(64),structure='2\nLattice="5 0 0 0 5 0 0 0 5" Properties=species:S:1:pos:R:3 pbc="T T T"\nCu 0 0 0\nNi 1 1 1\n';
function fixture(engine='gpumd.sampling'){
 const binding={id:'synthetic',class_name:'StudioCustom_synthetic',module_file:'studio_custom_'+privateCode+'.py',output_size:1,spec_sha256:h,parameters_sha256:j,code_sha256:privateCode,numerical_receipt_sha256:'d'.repeat(64)};
 const composition={status:'rendered',graph_sha256:h,source_sha256:j},graph={mode:'metad',metadata:{studio_custom_cvs:[binding]},nodes:[{id:'bias',kind:'bias',class_name:'WTMetaDGaussianBias'}],settings:{atoms_path:'model.xyz',cutoff:3,max_neighbors:32,max_cv_nums:32}};
 const nodes=[{id:'input',kind:'input'},{id:'neighbor',kind:'neighbor',class_name:'PCVectorLB'},{id:'custom_synthetic',kind:'cv',class_name:binding.class_name},{id:'collect',kind:'collect'},{id:'output',kind:'output'}];graph.nodes.unshift(...nodes);graph.edges=[['input','pos','neighbor','pos'],['input','cell','neighbor','cell'],['input','side_array','neighbor','side_array'],['input','pos','custom_synthetic','pos'],['input','cell','custom_synthetic','cell'],['input','side_array','custom_synthetic','side_array'],['custom_synthetic','value','collect','value'],['collect','cv','output','cv'],['collect','cv','bias','cv'],['input','cv_traj','bias','cv_traj'],['input','bias_traj','bias','bias_traj'],['bias','bias','output','bias']].map(([a,b,c,d])=>({source:{node:a,port:b},target:{node:c,port:d}}));
 const spec={engine,inputs:{},parameters:{bias_file:'bias.pt',structure_file:'model.xyz',mode:'wtmetad',cv_size:1,cutoff:3,atom_selection:[0,1],validation_history:'validation-history.txt'}};
 const texts={'model.xyz':structure,'validation-history.txt':'0.0004 1.5\n0.0008 1.7\n','run.in':'potential nep.txt\nvelocity 300\ntime_step 0.1\nGASMD bias.pt GAScfg.yaml\nensemble nve\ndump_thermo 1\ndump_restart 5\ndump_exyz 5\nrun 12\n','GAScfg.yaml':'cv_log_interval: 1\ncv_storage_interval: 2\ncv_size: 1\nneighbor_rc: 3\nmax_neighbors: 32\nmax_cv_nums: 32\ncv_change_interval: 1\nn_atoms: 2\ndebug_interval: 0\n','nep.txt':'nep4 2 Cu Ni\ncutoff 4 3 18 12\nn_max 2 2\nbasis_size 3 3\nl_max 2 0 0\nANN 8 0\n'+Array(282).fill('0.1').join('\n')+'\n'};
 if(engine==='bias.validate')for(const key of ['run.in','GAScfg.yaml','nep.txt'])delete texts[key];
 const files={'bias.pt':{path:'/owned/bias.pt',size:42,sha256:'e'.repeat(64),binary:true,text:null}};
 for(const [name,text]of Object.entries(texts))files[name]={path:'/owned/'+name,size:Buffer.byteLength(text),sha256:digest(text),binary:false,text};
 for(const [name,row]of Object.entries(files))spec.inputs[name]=row.path;
 const run={id:'actual-main-would-supply-opaque-id',engine:'pygas.build',project_id:'owned-project',status:'succeeded',exit:{exit_code:0},parameters:{output_file:'bias.pt',atom_selection:[0,1]},snapshots:[{name:'workflow.json',sha256:h},{name:'build_bias.py',sha256:j},{name:'model.xyz',sha256:files['model.xyz'].sha256},{name:binding.module_file,sha256:privateCode}],private_cv_versions:[{entry_id:'synthetic',spec_sha256:h,code_sha256:privateCode,parameters_sha256:j}]};
 const args={engine,task:{id:'same-task',workflowVersion:2,composition,artifacts:[{kind:'run',id:run.id,engine:'pygas.build'}]},spec,readFile:async name=>structuredClone(files[name]),producer:{run,artifact:{name:'bias.pt',size:42,sha256:'e'.repeat(64)}},currentPair:{composition,graph},privateBindings:[binding]};return {args,files,update(name,text){Object.assign(files[name],{text,size:Buffer.byteLength(text),sha256:digest(text)});}};
}
test('synthetic native NVE closure derives exact commands/config/type order without execution or approval',async()=>{const f=fixture(),r=await verifyConsumerInputs(f.args);assert.equal(r.entries.length,6);assert.equal(r.derivedControls.dynamics.steps,12);assert.deepEqual(r.derivedControls.nep_type_order,['Cu','Ni']);assert.equal(r.scientificValidation,'not_run');assert.equal(r.consumerConstraints.sameAuthoringEnvironmentRequired,false);assert.equal(r.consumerConstraints.projectId,'owned-project');assert.equal(r.entries[0].text,null);assert.equal(r.derivedControls.engine_restart,false);});
test('synthetic validator closure is only bias, structure and explicit validation history',async()=>{const {args}=fixture('bias.validate'),r=await verifyConsumerInputs(args);assert.equal(r.entries.length,3);assert.equal(r.derivedControls.validationHistory.kind,'validation_history_only_not_engine_restart');assert.equal(r.consumerConstraints.targetEnvironmentValidation,'required_actual_serialized_reload_CUDA_force_virial');});
test('selected optional history may be omitted; no inferred old history introduced',async()=>{const f=fixture();delete f.args.spec.inputs['validation-history.txt'];delete f.args.spec.parameters.validation_history;const r=await verifyConsumerInputs(f.args);assert.equal(r.entries.length,5);assert.equal(r.derivedControls.validationHistory,undefined);});
const inputCases=[
 ['external include command',f=>f.update('run.in',f.files['run.in'].text.replace('run 12','include secret.in\nrun 12'))],
 ['native history restart argument',f=>f.update('run.in',f.files['run.in'].text.replace('GAScfg.yaml','GAScfg.yaml old-history.txt'))],
 ['second native stage after run',f=>f.update('run.in',f.files['run.in'].text+'run 1\n')],
 ['duplicate command',f=>f.update('run.in',f.files['run.in'].text.replace('run 12','time_step 1\nrun 12'))],
 ['unsupported ensemble',f=>f.update('run.in',f.files['run.in'].text.replace('ensemble nve','ensemble nvt_nhc 300 300 100'))],
 ['missing actual potential',f=>f.update('run.in',f.files['run.in'].text.replace('potential nep.txt\n',''))],
 ['velocity extra seed unclosed',f=>f.update('run.in',f.files['run.in'].text.replace('velocity 300','velocity 300 1234'))],
 ['native bias different filename',f=>f.update('run.in',f.files['run.in'].text.replace('bias.pt','other.pt'))],
 ['undeclared native file extra',f=>f.args.spec.inputs['unknown.py']='/owned/unknown.py'],
 ['GAScfg duplicate key',f=>f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text+'cv_size: 2\n')],
 ['GAScfg hidden output path',f=>f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text+'cv_log_path: /outside/file\n')],
 ['GAScfg Observe flag unsupported',f=>f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text+'Observe: true\n')],
 ['GAScfg atom count mismatch',f=>f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text.replace('n_atoms: 2','n_atoms: 3'))],
 ['GAScfg capacity differs from graph',f=>f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text.replace('max_neighbors: 32','max_neighbors: 31'))],
 ['GAScfg cutoff below CV',f=>f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text.replace('neighbor_rc: 3','neighbor_rc: 2'))],
 ['NEP missing Ni',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('2 Cu Ni','1 Cu'))],
 ['NEP alternate format unclosed',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('nep4','nep4_zbl'))],
 ['NEP numeric tail hidden path',f=>f.update('nep.txt',f.files['nep.txt'].text+'outside.txt\n')],
 ['history column count',f=>f.update('validation-history.txt','1 2 3\n')],
 ['history nonfinite',f=>f.update('validation-history.txt','0.1 NaN\n')],
 ['unsafe file path',f=>{f.args.spec.inputs['run.in']='/owned/../run.in';f.files['run.in'].path='/owned/../run.in';}],
 ['binary artifact content exposed',f=>{f.files['bias.pt'].text='decoded bytes';}],
 ['changed binary artifact',f=>{f.files['bias.pt'].sha256='f'.repeat(64);}],
 ['partial read',f=>{f.files['run.in'].truncated=true;}],
 ['readback hash mismatch',f=>{f.files['run.in'].text+=' ';}],
 ['selected formal manifest unimplemented',f=>{f.args.spec.parameters.manifest_file='manifest.json';}],
 ['selected AOTI unsupported',f=>{f.args.spec.parameters.bias_file='bias.pt2';}],
 ['OPES selected not substituted',f=>{f.args.spec.parameters.mode='opes';}],
 ['multiple walkers',f=>{f.args.spec.parameters.sampling={walkers:2};}],
 ['declared dynamics mismatch',f=>{f.args.spec.parameters.dynamics={steps:13};}],
 ['undeclared dynamics controls',f=>{f.args.spec.parameters.dynamics={timestep_fs:0.1};}],
 ['producer not attached to same workflow',f=>{f.args.task.artifacts=[];}],
 ['consumer cutoff differs from graph',f=>{f.args.spec.parameters.cutoff=2;}],
 ['missing original producer',f=>{f.args.producer.run.status='ready';}],
 ['producer failed exit',f=>{f.args.producer.run.exit.exit_code=1;}],
 ['producer graph changed',f=>{f.args.producer.run.snapshots[0].sha256='0'.repeat(64);}],
 ['producer source changed',f=>{f.args.producer.run.snapshots[1].sha256='0'.repeat(64);}],
 ['producer private version changed',f=>{f.args.producer.run.private_cv_versions[0].parameters_sha256='0'.repeat(64);}],
 ['producer structure mismatch',f=>{f.args.producer.run.snapshots[2].sha256='0'.repeat(64);}],
 ['producer full CV group differs',f=>{f.args.spec.parameters.atom_selection=[0];}],
 ['producer output format/name differs',f=>{f.args.producer.run.parameters.output_file='other.pt';}],
 ['current pair differs',f=>{f.args.currentPair.composition={...f.args.currentPair.composition,graph_sha256:'0'.repeat(64)};}],
 ['private module source differs',f=>{f.args.producer.run.snapshots[3].sha256='0'.repeat(64);}],
 ['private width unknown',f=>{f.args.privateBindings[0].output_size=2;}],
 ['private numerical authority absent',f=>{delete f.args.privateBindings[0].numerical_receipt_sha256;}],
 ['invalid FD sample',f=>{f.args.spec.parameters.validation={atom_selection:[2]};}],
];
for(const [label,change]of inputCases)test(label+' is fail-closed before target execution',async()=>{const f=fixture();change(f);await assert.rejects(()=>verifyConsumerInputs(f.args),/Closed native input review:/);});
test('whitespace/comments and numeric representation do not change native values',async()=>{const f=fixture();f.update('run.in','# public template\n'+f.files['run.in'].text.replace('time_step 0.1','time_step 1e-1 # fs'));f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text.replace('neighbor_rc: 3','neighbor_rc: 3.0 # Angstrom'));assert.equal((await verifyConsumerInputs(f.args)).derivedControls.dynamics.dt_fs,0.1);});
test('bias class mapping is exact and does not infer WT from prose',async()=>{const f=fixture();f.args.currentPair.graph.nodes.find(n=>n.kind==='bias').class_name='MetaDGaussianBias';await assert.rejects(()=>verifyConsumerInputs(f.args),/selected mode/);f.args.spec.parameters.mode='metad';assert.equal((await verifyConsumerInputs(f.args)).derivedControls.mode,'metad');});
test('structure malformed or multiframe is rejected even when producer snapshot matches',async()=>{for(const text of [structure+structure,structure.replace('T T T','F T T'),structure.replace('Ni 1 1 1','Ni 1 NaN 1'),structure.replace('5 0 0 0 5 0 0 0 5','0 0 0 0 0 0 0 0 0')]){const f=fixture();f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/Closed native input review:/);}});

test('validator cutoff must equal graph even without GAScfg',async()=>{const f=fixture('bias.validate');f.args.spec.parameters.cutoff=2;await assert.rejects(()=>verifyConsumerInputs(f.args),/consumer cutoff/);});

const nativeIntegerCases=[['max_neighbors','3.2e1'],['max_neighbors','32.0'],['max_neighbors','0x20'],['max_cv_nums','3.2e1'],['cv_change_interval','1e2'],['debug_interval','0e0'],['cv_size','1.0'],['n_atoms','2e0']];
for(const [key,token]of nativeIntegerCases)test('native GAS integer '+key+' rejects nonliteral '+token,async()=>{const f=fixture();f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text.replace(new RegExp('^'+key+':.*$','m'),key+': '+token));await assert.rejects(()=>verifyConsumerInputs(f.args),/native decimal integer/);});
for(const key of ['run','dump_thermo','dump_restart','dump_exyz'])test('native command integer '+key+' rejects exponent syntax',async()=>{const f=fixture();f.update('run.in',f.files['run.in'].text.replace(new RegExp('^'+key+' .*$', 'm'),key+' 1e2'));await assert.rejects(()=>verifyConsumerInputs(f.args),/native decimal integer/);});
for(const suffix of [' pbc="F F F"',' PBC="T T T"',' Lattice="6 0 0 0 6 0 0 0 6"',' Properties=species:S:1:pos:R:3'])test('duplicate critical structure header '+suffix+' fails before native run',async()=>{const f=fixture(),rows=structure.split('\n');rows[1]+=suffix;const text=rows.join('\n');f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/exactly once/);});
for(const pbc of ['true true true','1 1 1'])test('native PBC spelling '+pbc+' is not accepted as T',async()=>{const f=fixture();const text=structure.replace('T T T',pbc);f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/periodic extxyz/);});
test('noncanonical native Properties quoting fails closed',async()=>{const f=fixture(),text=structure.replace('Properties=species:S:1:pos:R:3','Properties="species:S:1:pos:R:3"');f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/periodic extxyz/);});
test('native NEP integer header never reinterprets exponent syntax',async()=>{const f=fixture();f.update('nep.txt',f.files['nep.txt'].text.replace('ANN 8 0','ANN 8e0 0'));await assert.rejects(()=>verifyConsumerInputs(f.args),/native decimal integer/);});

for(const [file,original,replacement]of [['run.in','run 12','run 012'],['run.in','run 12','run 1.2e1'],['GAScfg.yaml','max_neighbors: 32','max_neighbors: 032'],['nep.txt','nep4 2 Cu Ni','nep4 02 Cu Ni']])test('canonical integer spelling '+replacement+' prevents native base interpretation',async()=>{const f=fixture();f.update(file,f.files[file].text.replace(original,replacement));await assert.rejects(()=>verifyConsumerInputs(f.args),/native decimal integer/);});
test('leading-zero atom count cannot diverge from GPUMD base-zero parser',async()=>{const f=fixture(),text=structure.replace(/^2\n/,'02\n');f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/native decimal integer/);});

for(const prop of ['POS:R:3','SPECIES:R:3','Pos:R:3','species:R:3'])test('casefolded duplicate property '+prop+' cannot override native coordinates/type',async()=>{const f=fixture(),rows=structure.trimEnd().split('\n');rows[1]=rows[1].replace('pos:R:3','pos:R:3:'+prop);for(let i=2;i<rows.length;i++)rows[i]+=' 4 4 4';const text=rows.join('\n')+'\n';f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/duplicate structure property/);});
for(const duplicate of ['pbc = "F F F"','Lattice\t=\t"6 0 0 0 6 0 0 0 6"','Properties = species:S:1:pos:R:3'])test('native removes equals whitespace but duplicate '+duplicate+' stays blocked',async()=>{const f=fixture(),rows=structure.trimEnd().split('\n');rows[1]+=' '+duplicate;const text=rows.join('\n')+'\n';f.update('model.xyz',text);f.args.producer.run.snapshots[2].sha256=digest(text);await assert.rejects(()=>verifyConsumerInputs(f.args),/exactly once/);});
const renderFixture=()=>({graph:fixture().args.currentPair.graph,nAtoms:2,biasFile:'bias.pt',values:{temperature_K:300,dt_fs:0.1,steps:12,cv_log_interval:1,cv_storage_interval:2,cv_change_interval:1,dump_thermo:1,dump_restart:5,dump_exyz:5},sourceContract:{sha256:h,source:'Synthetic native grammar fixture, never a real target receipt'}});
test('pure proposal has explicit missing fields and no file/approval when science unknown',()=>{const f=renderFixture();f.values={};const r=renderConsumerInputs(f);assert.equal(r.status,'blocked');assert.equal(r.missingFields.length,9);assert.deepEqual(r.files,[]);assert.equal(r.scientificValidation,'not_run');});
test('pure proposal produces deterministic native texts and known canonical integer tokens',()=>{const f=renderFixture(),r=renderConsumerInputs(f);assert.equal(r.status,'complete');assert.equal(r.files.length,2);assert.equal(r.files[0].sha256,digest(r.files[0].text));assert.equal(r.files[0].text,fixture().files['run.in'].text);assert.match(r.files[1].text,/max_neighbors: 32\n/);assert.equal(r.scientificValidation,'not_run');assert.equal(r.provenance.technicalChoices.ensemble,'Explicit NVE-only template choice');assert.equal(renderConsumerInputs(f).files[0].text,r.files[0].text);});
test('proposal and closure agree without any scientific engine',async()=>{const f=fixture(),r=renderConsumerInputs(renderFixture());for(const row of r.files)f.update(row.name,row.text);assert.equal((await verifyConsumerInputs(f.args)).derivedControls.dynamics.steps,12);});
for(const [label,change]of [['unknown parameter',f=>{f.values.restart='old.pt';}],['numeric string',f=>{f.values.steps='12';}],['fractional steps',f=>{f.values.steps=12.1;}],['negative temperature',f=>{f.values.temperature_K=-1;}],['nonfinite dt',f=>{f.values.dt_fs=Infinity;}],['AOTI file',f=>{f.biasFile='bias.pt2';}],['missing capacities',f=>{delete f.graph.settings.max_cv_nums;}],['unknown full bias',f=>{f.graph.nodes.find(n=>n.kind==='bias').class_name='OPESBias';}],['unknown source',f=>{f.sourceContract.sha256='';}]])test('pure proposal rejects '+label,()=>{const f=renderFixture();change(f);assert.throws(()=>renderConsumerInputs(f),/Closed native input review:/);});

for(const [label,change]of [['second public CV',g=>g.nodes.push({id:'other',kind:'cv',class_name:'Volume'})],['second collector',g=>g.nodes.push({id:'other',kind:'collect'})],['extra collector input',g=>g.edges.push({source:{node:'input',port:'pos'},target:{node:'collect',port:'value'}})],['missing edge',g=>g.edges.pop()],['node scalar override',g=>g.nodes.find(n=>n.kind==='cv').output_size=1],['unknown CV class',g=>g.nodes.find(n=>n.kind==='cv').class_name='Other'],['duplicate edge',g=>g.edges.push(structuredClone(g.edges[0]))]])test('complete scalar contract rejects '+label,async()=>{const f=fixture();change(f.args.currentPair.graph);await assert.rejects(()=>verifyConsumerInputs(f.args),/scalar private collector topology/);assert.throws(()=>renderConsumerInputs({...renderFixture(),graph:f.args.currentPair.graph}),/closed private collector topology/);});
test('one explicit identity preserves exact scalar path and no other reduction is accepted',async()=>{const f=fixture(),g=f.args.currentPair.graph;g.nodes.push({id:'identity',kind:'reduce',params:{operation:'identity'}});g.edges=g.edges.filter(e=>!(e.source.node==='custom_synthetic'&&e.target.node==='collect'));g.edges.push({source:{node:'custom_synthetic',port:'value'},target:{node:'identity',port:'value'}},{source:{node:'identity',port:'value'},target:{node:'collect',port:'value'}});assert.equal((await verifyConsumerInputs(f.args)).derivedControls.cv_size,1);g.nodes.at(-1).params.operation='mean';await assert.rejects(()=>verifyConsumerInputs(f.args),/scalar private collector topology/);});

// This is structurally complete synthetic numeric data, not a trained force field.
const nativeLayoutCases=[
 ['attached potential comment changes literal filename',f=>f.update('run.in',f.files['run.in'].text.replace('nep.txt','nep.txt#suffix'))],
 ['attached GAScfg comment changes literal filename',f=>f.update('run.in',f.files['run.in'].text.replace('GAScfg.yaml','GAScfg.yaml#suffix'))],
 ['attached ensemble comment changes ensemble token',f=>f.update('run.in',f.files['run.in'].text.replace('ensemble nve','ensemble nve#suffix'))],
 ['NEP leading full comment is a physical header row',f=>f.update('nep.txt','# model note\n'+f.files['nep.txt'].text)],
 ['NEP leading blank is a physical header row',f=>f.update('nep.txt','\n'+f.files['nep.txt'].text)],
 ['NEP internal blank is a physical parameter row',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('ANN 8 0\n','ANN 8 0\n\n'))],
 ['NEP inline header marker changes element token',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('Cu Ni','Cu Ni#suffix'))],
 ['NEP numeric tail cannot contain a stripped comment',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('0.1\n','0.1 # row\n'))],
 ['NEP truncated numeric rows',f=>f.update('nep.txt',f.files['nep.txt'].text.split('\n').slice(0,8).join('\n')+'\n')],
 ['NEP extra numeric rows',f=>f.update('nep.txt',f.files['nep.txt'].text+'0.1\n')],
 ['NEP two numbers on a physical row',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('0.1\n0.1\n','0.1 0.1\n'))],
 ['NEP cutoff missing native neighbor counts',f=>f.update('nep.txt',f.files['nep.txt'].text.replace('cutoff 4 3 18 12','cutoff 4 3'))]
];
for(const [name,change]of nativeLayoutCases)test('native line contract rejects '+name,async()=>{const f=fixture();change(f);await assert.rejects(()=>verifyConsumerInputs(f.args),/Closed native input review:/);});
test('native run whitespace comment tokens are preserved as comments without hidden stages',async()=>{const f=fixture();f.update('run.in','# input note\n'+f.files['run.in'].text.replace('potential nep.txt','potential nep.txt # ordinary comment include unrelated.in'));assert.equal((await verifyConsumerInputs(f.args)).derivedControls.dynamics.steps,12);});
test('native GAScfg value comment remains allowed and does not change scalar',async()=>{const f=fixture();f.update('GAScfg.yaml',f.files['GAScfg.yaml'].text.replace('neighbor_rc: 3','neighbor_rc: 3# native value comment'));assert.equal((await verifyConsumerInputs(f.args)).derivedControls.GAScfg.neighbor_rc,3);});

test('NEP4 higher-body source flags change descriptor width and exact physical row count',async()=>{const f=fixture();const header='nep4 2 Cu Ni\ncutoff 4 3 18 12\nn_max 2 2\nbasis_size 3 3\nl_max 2 2 1\nANN 8 0\n';f.update('nep.txt',header+Array(384).fill('0.1').join('\n')+'\n');assert.deepEqual((await verifyConsumerInputs(f.args)).derivedControls.nep_type_order,['Cu','Ni']);f.update('nep.txt',header+Array(383).fill('0.1').join('\n')+'\n');await assert.rejects(()=>verifyConsumerInputs(f.args),/physical row count/);});
test('NEP4 source-known neighbor header bound rejects unsupported capacity',async()=>{const f=fixture();f.update('nep.txt',f.files['nep.txt'].text.replace('18 12','820 12'));await assert.rejects(()=>verifyConsumerInputs(f.args),/bounded native NEP4/);});
