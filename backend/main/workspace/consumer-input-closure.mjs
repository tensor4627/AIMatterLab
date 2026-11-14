import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const name=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)&&!['.','..'].includes(value);
const path=value=>typeof value==='string'&&value.startsWith('/')&&value.length<=4096&&!/[\\\r\n\0]/.test(value)&&!value.slice(1).split('/').some(p=>p==='.'||p==='..'||p==='');
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const integer=value=>Number.isSafeInteger(value)&&value>0;
const requireThat=(test,message)=>{if(!test)throw Error('Closed native input review: '+message);};
function number(token){requireThat(typeof token==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)&&Number.isFinite(Number(token)),'finite numeric native token required');return Number(token);}
function nativeInteger(token,zero=false){requireThat(typeof token==='string'&&/^(?:0|[1-9]\d*)$/.test(token)&&Number.isSafeInteger(Number(token))&&Number(token)<=2147483647&&(zero?Number(token)>=0:Number(token)>0),'native decimal integer literal required, no exponent/fraction/prefix');return Number(token);}
function lines(text){return text.split(/\r?\n/).map(line=>line.split('#',1)[0].trim()).filter(Boolean);}
function structure(text){
 const rows=text.trimEnd().split(/\r?\n/);requireThat(/^\d+$/.test(rows[0]),'one explicit extxyz structure is required');const n=nativeInteger(rows[0]);requireThat(integer(n)&&n<=4096&&rows.length===n+2,'single bounded structure, no additional trajectory frames');
 const header=rows[1];for(const key of ['pbc','lattice','properties'])requireThat([...header.matchAll(new RegExp('(?:^|\\s)'+key+'\\s*=', 'gi'))].length===1,'each critical extxyz header must occur exactly once: '+key);const properties=/(?:^|\s)Properties=(?:"([^"]+)"|([^\s"]+))/.exec(header),lattice=/(?:^|\s)Lattice="([^"]+)"/.exec(header),pbc=/(?:^|\s)pbc="([^"]+)"/.exec(header);
 requireThat(properties&&!properties[1]&&lattice&&pbc&&/^T\s+T\s+T$/i.test(pbc[1]),'explicit three-dimensional periodic extxyz properties/lattice required');
 const cell=lattice[1].trim().split(/\s+/).map(number);requireThat(cell.length===9,'nine lattice components required');const det=cell[0]*(cell[4]*cell[8]-cell[5]*cell[7])-cell[1]*(cell[3]*cell[8]-cell[5]*cell[6])+cell[2]*(cell[3]*cell[7]-cell[4]*cell[6]);requireThat(Math.abs(det)>1e-12,'nondegenerate lattice required');
 const columns=(properties[1]||properties[2]).split(':');requireThat(columns.length%3===0&&columns.length<=48,'bounded extxyz property declaration required');let width=0,speciesAt=-1,posAt=-1;const propertyNames=new Set();
 for(let i=0;i<columns.length;i+=3){const key=columns[i],type=columns[i+1],count=nativeInteger(columns[i+2]);requireThat(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)&&/^[SRI]$/.test(type)&&integer(count)&&count<=9,'unknown extxyz property type');requireThat(!propertyNames.has(key.toLowerCase()),'case-insensitive duplicate structure property changes native offsets');propertyNames.add(key.toLowerCase());requireThat(!['vel','mass','charge','group'].includes(key.toLowerCase()),'native velocity/mass/charge/group structure controls require another explicit contract');if(key==='species'){requireThat(speciesAt===-1&&type==='S'&&count===1,'one species column required');speciesAt=width;}else if(key==='pos'){requireThat(posAt===-1&&type==='R'&&count===3,'one Cartesian pos vector required');posAt=width;}else requireThat(type!=='S','only species may be a string column');width+=count;}
 requireThat(speciesAt>=0&&posAt>=0,'species and pos fields required');const species=[];
 for(const row of rows.slice(2)){const tokens=row.trim().split(/\s+/);requireThat(tokens.length===width&&/^[A-Z][a-z]?$/.test(tokens[speciesAt]),'atom row width/species differs from Properties');species.push(tokens[speciesAt]);for(let i=0;i<tokens.length;i++)if(i!==speciesAt)number(tokens[i]);}
 return {nAtoms:n,species:[...new Set(species)],cell,pbc:[true,true,true]};
}
function nep(text,species){
 // Native NEP reads one physical line at a time without comment removal.
 requireThat(!text.includes('#'),'native NEP comments are outside the closed model format');
 const rows=text.replace(/\r?\n$/,'').split(/\r?\n/);requireThat(rows.every(row=>!!row.trim()),'native NEP physical rows cannot be blank');
 const first=rows.shift()?.trim().split(/\s+/);requireThat(first&&first[0]==='nep4'&&/^\d+$/.test(first[1]),'this closed contract supports native non-ZBL NEP4 only');const count=nativeInteger(first[1]),types=first.slice(2);requireThat(integer(count)&&count<=16&&types.length===count&&new Set(types).size===count&&species.every(symbol=>types.includes(symbol)),'NEP type header does not contain each structure element');
 const header={};
 for(const [key,lengths]of [['cutoff',[4]],['n_max',[2]],['basis_size',[2]],['l_max',[3]],['ANN',[2]]]){
  const row=rows.shift()?.trim().split(/\s+/);requireThat(row&&row[0]===key&&lengths.includes(row.length-1),'NEP4 native header must be complete with known numeric fields: '+key);
  header[key]=row.slice(1).map((token,index)=>key==='cutoff'&&index<2?number(token):nativeInteger(token,true));
 }
 requireThat(header.cutoff.slice(0,2).every(positive)&&header.cutoff.slice(2).every(v=>integer(v)&&v<=819),'positive bounded native NEP4 cutoff/neighbor header required');
 requireThat([0,2].includes(header.l_max[1])&&[0,1].includes(header.l_max[2])&&integer(header.ANN[0])&&header.ANN[1]===0,'known native NEP4 higher-body flags and ANN header required');
 const numL=header.l_max[0]+(header.l_max[1]===2?1:0)+(header.l_max[2]===1?1:0),dim=(header.n_max[0]+1)+(header.n_max[1]+1)*numL;
 const ann=(dim+2)*header.ANN[0]*count+1,descriptor=count*count*((header.n_max[0]+1)*(header.basis_size[0]+1)+(header.n_max[1]+1)*(header.basis_size[1]+1)),expected=ann+descriptor+dim;
 requireThat(Number.isSafeInteger(expected)&&expected>0&&expected<=1000000&&rows.length===expected,'native NEP4 parameter/scaler physical row count differs from source formula');
 for(const row of rows){const tokens=row.trim().split(/\s+/);requireThat(tokens.length===1,'native NEP4 consumes exactly one numeric parameter per physical row');number(tokens[0]);}
 return types;
}
function gas(text){
 const keys=['max_cv_nums','cv_size','cv_storage_interval','cv_change_interval','cv_log_interval','neighbor_rc','max_neighbors','n_atoms'],result={};
 for(const line of lines(text)){const m=/^([A-Za-z_]+)\s*:\s*(\S+)$/.exec(line);requireThat(m&&[...keys,'debug_interval'].includes(m[1])&&!Object.hasOwn(result,m[1]),'unknown/duplicate/non-scalar GAScfg field, output paths or flags require another contract');result[m[1]]=m[1]==='neighbor_rc'?number(m[2]):nativeInteger(m[2],m[1]==='debug_interval');}
 for(const key of keys)requireThat(key==='neighbor_rc'?positive(result[key]):integer(result[key]),'GAScfg positive declared field required: '+key);
 if(Object.hasOwn(result,'debug_interval'))requireThat(Number.isSafeInteger(result.debug_interval)&&result.debug_interval>=0,'invalid debug interval');return result;
}
function runInput(text,bias){
 // GPUMD drops a comment only when # starts a whitespace-delimited token.
 const rows=[];for(const line of text.split(/\r?\n/)){const tokens=line.trim().split(/\s+/),kept=[];for(const token of tokens){if(!token)continue;if(token.startsWith('#'))break;requireThat(!token.includes('#'),'native run command tokens cannot contain an attached comment marker');kept.push(token);}if(kept.length)rows.push(kept);}
 const commands=new Map();let executed=false;
 for(const row of rows){const key=row[0];requireThat(['potential','velocity','time_step','GASMD','ensemble','dump_thermo','dump_restart','dump_exyz','run'].includes(key)&&!commands.has(key),'unknown/duplicate native command or hidden input dependency');requireThat(!executed,'no commands or additional stages after run');commands.set(key,row.slice(1));if(key==='run')executed=true;}
 for(const key of ['potential','velocity','time_step','GASMD','ensemble','run'])requireThat(commands.has(key),'missing explicit native command: '+key);
 requireThat(equal(commands.get('potential'),['nep.txt'])&&equal(commands.get('GASMD'),[bias,'GAScfg.yaml'])&&equal(commands.get('ensemble'),['nve']),'only one explicit nep.txt + GASMD .pt with no restart, NVE consumer is currently closed');
 const values={};for(const [key,out]of [['velocity','temperature_K'],['time_step','dt_fs'],['run','steps'],['dump_thermo','dump_thermo'],['dump_restart','dump_restart'],['dump_exyz','dump_exyz']])if(commands.has(key)){const tokens=commands.get(key);requireThat(tokens.length===1,'single numeric native '+key+' required');values[out]=['velocity','time_step'].includes(key)?number(tokens[0]):nativeInteger(tokens[0]);requireThat(['velocity','time_step'].includes(key)?positive(values[out]):integer(values[out]),'invalid native '+key);}
 requireThat(values.steps<=1000000,'closed review bounded step count exceeded');return {ensemble:'nve',...values};
}
function history(text,size){
 const rows=lines(text);requireThat(rows.length>0&&rows.length<=10000,'bounded nonempty explicit validation history required');for(const row of rows){const tokens=row.split(/\s+/);requireThat(tokens.length===size+1,'validation history must contain saved bias then exact CV vector');tokens.forEach(number);}return {rows:rows.length,kind:'validation_history_only_not_engine_restart',columns:size+1};
}
function scalarPrivateGraph(graph,bindings){
 if(graph?.mode!=='metad'||!Array.isArray(bindings)||bindings.length!==1||typeof bindings[0].id!=='string'||bindings[0].output_size!==1||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))return false;
 const identity=graph.nodes.some(n=>n?.kind==='reduce'),kinds=['input','neighbor','cv','collect','output','bias',...identity?['reduce']:[]];
 if(graph.nodes.length!==kinds.length||kinds.some(k=>graph.nodes.filter(n=>n?.kind===k).length!==1)||graph.nodes.some(n=>!name(n.id)||n.output_size!==undefined&&n.output_size!==null))return false;
 const by=Object.fromEntries(graph.nodes.map(n=>[n.kind,n])),ids=Object.fromEntries(Object.entries(by).map(([k,n])=>[k,n.id]));if(new Set(Object.values(ids)).size!==kinds.length||!['PCVectorLB','PCVectorTypesFilter'].includes(by.neighbor.class_name)||by.cv.class_name!==bindings[0].class_name||by.cv.id!=='custom_'+bindings[0].id||identity&&!equal(by.reduce.params,{operation:'identity'}))return false;
 const paths=[['input','pos','neighbor','pos'],['input','cell','neighbor','cell'],['input','side_array','neighbor','side_array'],['input','pos','cv','pos'],['input','cell','cv','cell'],['input','side_array','cv','side_array'],...identity?[['cv','value','reduce','value'],['reduce','value','collect','value']]:[['cv','value','collect','value']],['collect','cv','output','cv'],['collect','cv','bias','cv'],['input','cv_traj','bias','cv_traj'],['bias','bias','output','bias'],...by.bias.class_name!=='FlexibleWallBias'?[['input','bias_traj','bias','bias_traj']]:[]];
 const desired=new Set(paths.map(([a,b,c,d])=>JSON.stringify([ids[a],b,ids[c],d])));let actual;
 try{actual=graph.edges.map(e=>JSON.stringify([e.source.node,e.source.port,e.target.node,e.target.port]));}catch{return false;}
 return actual.length===desired.size&&new Set(actual).size===desired.size&&actual.every(key=>desired.has(key));
}
function versions(bindings){return bindings.map(b=>({entry_id:b.id,spec_sha256:b.spec_sha256,code_sha256:b.code_sha256,parameters_sha256:b.parameters_sha256}));}
/** Pure data verification. All objects/callbacks must come from guarded main/worker reads, never renderer-supplied authority. */
export async function verifyConsumerInputs({engine,task,spec,readFile,producer,currentPair,privateBindings=[]}){
 requireThat(['bias.validate','gpumd.sampling'].includes(engine)&&spec?.engine===engine,'unsupported consumer engine');requireThat(typeof readFile==='function'&&object(spec.inputs)&&object(spec.parameters),'trusted bounded file reader and scientific spec required');
 const p=spec.parameters,c=currentPair?.composition,g=currentPair?.graph,run=producer?.run,output=producer?.artifact;
 requireThat(task?.workflowVersion===2&&task.composition?.status==='rendered'&&equal(task.composition,c)&&g?.mode==='metad'&&equal(g.metadata?.studio_custom_cvs||[],privateBindings),'same current saved full-bias graph/owner binding required');
 requireThat(scalarPrivateGraph(g,privateBindings),'only the exact source-supported scalar private collector topology is currently closed; mixed CVs/unknown reductions require another contract');
 const biases=g.nodes?.filter(node=>node.kind==='bias');requireThat(biases?.length===1,'exactly one native pyGAS bias required');const mode={MetaDGaussianBias:'metad',WTMetaDGaussianBias:'wtmetad',FFWTPDMetaDGaussianBias:'wtmetad',FlexibleWallBias:'static'}[biases[0].class_name];requireThat(mode&&p.mode===mode,'selected mode must equal actual saved bias class; no OPES/cvonly/backend substitution');
 requireThat(name(p.bias_file)&&p.bias_file.endsWith('.pt')&&p.structure_file==='model.xyz'&&p.cv_size===1&&positive(p.cutoff)&&!p.manifest_file&&!p.kernel_capacity,'single explicit scalar .pt with matching structure required; selected manifest/AOTI/kernel contract unsupported, never discarded');
 requireThat((p.walkers??p.sampling?.walkers??1)===1&&(!p.validation||object(p.validation)),'single walker and typed validation only');
 requireThat(run?.engine==='pygas.build'&&run.status==='succeeded'&&run.exit?.exit_code===0&&typeof run.id==='string'&&run.id&&typeof run.project_id==='string'&&run.project_id&&run.parameters?.output_file===p.bias_file&&name(output?.name)&&output.name===p.bias_file&&sha(output.sha256)&&integer(output.size),'actual successful same-version producer and current collected artifact required');
 requireThat(task.artifacts?.some(row=>row.kind==='run'&&row.id===run.id&&row.engine==='pygas.build'),'producer must be an actual recorded run attached to this same workflow');
 requireThat(p.cutoff===g.settings?.cutoff,'consumer cutoff must equal current saved graph for both validation and native MD');
 const pairHashes={'workflow.json':c.graph_sha256,'build_bias.py':c.source_sha256};requireThat(Object.values(pairHashes).every(sha)&&Array.isArray(run.snapshots)&&new Set(run.snapshots.map(s=>s.name)).size===run.snapshots.length,'known canonical producer input snapshots required');for(const [key,value]of Object.entries(pairHashes))requireThat(run.snapshots.some(s=>s.name===key&&s.sha256===value),'producer canonical pair differs from current saved graph/source');
 requireThat(Array.isArray(privateBindings)&&privateBindings.length<=1&&equal(run.private_cv_versions||[],versions(privateBindings)),'producer private version lineage differs');
 for(const b of privateBindings){requireThat(typeof b.id==='string'&&[b.spec_sha256,b.code_sha256,b.parameters_sha256,b.numerical_receipt_sha256].every(sha)&&b.output_size===1&&b.module_file==='studio_custom_'+b.code_sha256+'.py'&&run.snapshots.some(s=>s.name===b.module_file&&s.sha256===b.code_sha256),'one exact approved scalar private module snapshot required');}
 const ioName=g.settings?.atoms_path;requireThat(name(ioName)&&run.snapshots.some(s=>s.name===ioName&&sha(s.sha256)),'producer structure snapshot binding required');
 const names=[p.bias_file,p.structure_file,...p.validation_history?[p.validation_history]:[],...engine==='gpumd.sampling'?['run.in','GAScfg.yaml','nep.txt']:[]];
 requireThat(names.every(name)&&new Set(names).size===names.length&&equal(Object.keys(spec.inputs).sort(),names.slice().sort()),'actual scientific input list must exactly equal closed dependency set');
 const entries=[];let textBytes=0;for(const key of names){const file=await readFile(key);requireThat(file?.path===spec.inputs[key]&&path(file.path)&&file.path.endsWith('/'+key)&&sha(file.sha256)&&Number.isSafeInteger(file.size)&&file.size>0&&!file.truncated,'exact current complete file identity required: '+key);const binary=key===p.bias_file;
  if(binary)requireThat(file.binary===true&&(file.text===null||file.text===undefined)&&file.size<=64*1024*1024&&file.sha256===output.sha256&&file.size===output.size,'serialized binary must match observed successful producer output; metadata alone is not ABI proof');
  else{requireThat(file.binary===false&&typeof file.text==='string'&&!file.text.includes('\0')&&file.size<=2*1024*1024&&Buffer.byteLength(file.text)===file.size&&digest(file.text)===file.sha256,'complete bounded UTF-8 readback differs: '+key);textBytes+=file.size;requireThat(textBytes<=8*1024*1024,'total native text review bound exceeded');}
  entries.push({name:key,path:file.path,size:file.size,sha256:file.sha256,binary,role:binary?'serialized-bias':key===p.structure_file?'structure':key===p.validation_history?'validation-history':key==='run.in'?'native-commands':key==='GAScfg.yaml'?'native-sampling-config':'native-nep-potential',text:binary?null:file.text});
 }
 const by=new Map(entries.map(e=>[e.name,e])),s=structure(by.get('model.xyz').text),originalStructure=run.snapshots.find(row=>row.name===ioName);requireThat(by.get('model.xyz').sha256===originalStructure.sha256,'consumer structure differs from exact producer representative structure');
 requireThat(Array.isArray(p.atom_selection)&&p.atom_selection.length>0&&p.atom_selection.every(i=>Number.isSafeInteger(i)&&i>=0&&i<s.nAtoms)&&new Set(p.atom_selection).size===p.atom_selection.length&&equal(p.atom_selection,run.parameters.atom_selection),'exact full CV atom group must equal producer, not just finite difference sample');
 if(p.validation?.atom_selection)requireThat(Array.isArray(p.validation.atom_selection)&&p.validation.atom_selection.length<=32&&p.validation.atom_selection.every(i=>Number.isSafeInteger(i)&&i>=0&&i<s.nAtoms)&&new Set(p.validation.atom_selection).size===p.validation.atom_selection.length,'invalid FD sample indices');
 const derived={mode,cv_size:1,n_atoms:s.nAtoms,atom_selection:structuredClone(p.atom_selection),structure_sha256:by.get('model.xyz').sha256,bias_sha256:output.sha256};
 if(p.validation_history){requireThat(name(p.validation_history),'only an actual listed validation history basename');derived.validationHistory=history(by.get(p.validation_history).text,1);}
 if(engine==='gpumd.sampling'){
  const config=gas(by.get('GAScfg.yaml').text),dynamics=runInput(by.get('run.in').text,p.bias_file),types=nep(by.get('nep.txt').text,s.species);requireThat(config.cv_size===1&&config.n_atoms===s.nAtoms&&config.neighbor_rc>=p.cutoff,'native GAScfg CV/structure/cutoff differs');
  for(const key of ['cutoff','max_neighbors','max_cv_nums']){const setting=g.settings?.[key];requireThat(positive(setting),'actual graph capacity/cutoff required');requireThat(key==='cutoff'?setting===p.cutoff:config[key]===setting,'native capacity/cutoff differs from exact saved producer graph');}
  if(p.dynamics){requireThat(object(p.dynamics)&&Object.keys(p.dynamics).every(key=>['ensemble','temperature','temperature_K','dt_fs','steps','walkers'].includes(key)),'unknown declared dynamics field requires another native contract');for(const [key,value]of Object.entries(p.dynamics)){const native=key==='temperature'?dynamics.temperature_K:key==='walkers'?1:dynamics[key];requireThat(equal(value,native),'declared dynamics differs from actual run.in: '+key);}}
  Object.assign(derived,{GAScfg:config,dynamics,nep_type_order:types,engine_restart:false});
 }
 return {kind:'closed-native-consumer-inputs-v1',engine,entries,derivedControls:derived,provenance:{run_id:run.id,producer_output_observation:'Current collected output SHA, not historical completion-time attestation',graph_sha256:c.graph_sha256,source_sha256:c.source_sha256},consumerConstraints:{target:'local',projectId:run.project_id,artifactBackend:'torchscript',sameAuthoringEnvironmentRequired:false,targetEnvironmentValidation:'required_actual_serialized_reload_CUDA_force_virial',unknownRunResubmit:false},unresolved:[],scientificValidation:'not_run'};
}

/** Pure source-derived NVE template. Missing human science stays explicit; this never writes files or grants execution. */
export function renderConsumerInputs({graph,nAtoms,biasFile,values,sourceContract}){
 requireThat(graph?.mode==='metad'&&integer(nAtoms)&&nAtoms>=2&&nAtoms<=4096&&name(biasFile)&&biasFile.endsWith('.pt')&&object(values),'explicit actual scalar bias/structure and typed native values required');
 requireThat(object(sourceContract)&&sha(sourceContract.sha256)&&typeof sourceContract.source==='string'&&sourceContract.source.length<=256,'trusted main-owned source contract identity required');
 const fields=['temperature_K','dt_fs','steps','cv_log_interval','cv_storage_interval','cv_change_interval','dump_thermo','dump_restart','dump_exyz'];
 requireThat(Object.keys(values).every(key=>fields.includes(key)),'unknown native renderer setting');
 const missing=fields.filter(key=>values[key]===undefined||values[key]===null||values[key]==='');
 if(missing.length)return {kind:'native-NVE-input-proposal-v1',status:'blocked',missingFields:missing,files:[],scientificValidation:'not_run',scope:'No native files or values generated until explicit required values are supplied'};
 for(const key of fields)requireThat(['temperature_K','dt_fs'].includes(key)?positive(values[key]):integer(values[key])&&values[key]<=2147483647,'invalid explicit native setting '+key);
 requireThat(values.steps<=1000000,'bounded native step count exceeded');
 requireThat(scalarPrivateGraph(graph,graph.metadata?.studio_custom_cvs),'pure scalar template requires the same closed private collector topology');
 const settings=graph.settings||{};requireThat(positive(settings.cutoff)&&integer(settings.max_neighbors)&&settings.max_neighbors<=2147483647&&integer(settings.max_cv_nums)&&settings.max_cv_nums<=2147483647,'actual graph cutoff/neighbour/history capacities required');
 const biases=graph.nodes?.filter(node=>node.kind==='bias');requireThat(biases?.length===1&&['MetaDGaussianBias','WTMetaDGaussianBias','FFWTPDMetaDGaussianBias','FlexibleWallBias'].includes(biases[0].class_name),'one known full bias class required; no OPES conversion');
 const rows=['potential nep.txt','velocity '+String(values.temperature_K),'time_step '+String(values.dt_fs),'GASMD '+biasFile+' GAScfg.yaml','ensemble nve',...['dump_thermo','dump_restart','dump_exyz'].map(key=>key+' '+String(values[key])),'run '+String(values.steps)];
 const config={cv_log_interval:values.cv_log_interval,cv_storage_interval:values.cv_storage_interval,cv_size:1,neighbor_rc:settings.cutoff,max_neighbors:settings.max_neighbors,max_cv_nums:settings.max_cv_nums,cv_change_interval:values.cv_change_interval,n_atoms:nAtoms,debug_interval:0};
 const files=[{name:'run.in',text:rows.join('\n')+'\n'},{name:'GAScfg.yaml',text:Object.entries(config).map(([key,value])=>key+': '+String(value)).join('\n')+'\n'}].map(row=>({...row,sha256:digest(row.text),size:Buffer.byteLength(row.text)}));
 return {kind:'native-NVE-input-proposal-v1',status:'complete',missingFields:[],files,derivedControls:{ensemble:'nve',...structuredClone(values),GAScfg:config},provenance:{source:structuredClone(sourceContract),userValues:fields,graphValues:['cutoff','max_neighbors','max_cv_nums'],technicalChoices:{ensemble:'Explicit NVE-only template choice',potential:'Fixed reviewed basename nep.txt; actual selected potential must be checked',debug_interval:'AIMatterLab template technical choice 0; not a scientific value',restart:'No input restart; dump_restart writes an output only'}},scientificValidation:'not_run',scope:'Human draft proposal only; actual selected dependency hash closure, review, immutable snapshots and target validation are required'};
}
