"""Exact registered sampling public AST reader. No target imports, execution or writes."""
import ast,copy,hashlib,json,re,subprocess
from pathlib import Path
from studio_worker.compute.runtime_guides import RuntimeGuides,fingerprint,sampling_provenance
from studio_worker.tools.source_git_identity import git_identity as source_git_identity,SourceGitError
METHODS={
'pydyn/dynamics/driver.py':{'Simulation':('__init__','run','prepare','attach','finalize','_initialize','_step')},
'pydyn/dynamics/ensembles/nvt.py':{'NVTBerendsen':('__init__',),'NVTNoseHoover':('__init__',)},
'pydyn/dynamics/ensembles/npt.py':{'MTTKNPT':('__init__',)},
'pydyn/context.py':{'SimulationContext':('__init__','resolve','get_temperature'),'ResolvedSimulationContext':('get_temperature',),'TargetStress':('__init__',)},
'pydyn/state.py':{'State':('__init__','from_atoms')},
'pydyn/forces/ml.py':{'TorchMLForceModel':('cupy_to_model_tensor',)},
'pydyn/forces/base.py':{'ForceModel':('__init__',)},
'pydyn/forces/hotpp_force.py':{'MiaoForceModel':('__init__','neighbor_request','build_input','map_properties','run_model','update_results')},
'pydyn/sampling/integrations/pydyn.py':{'PyGASForceModel':('__init__','validate','neighbor_request','on_initialize','before_step','geometry_changed','after_step','on_finalize','compute'),'BiasedForceEvaluator':('__init__','validate_properties','invalidate','begin_batch','end_batch','compute')},
'pydyn/sampling/runtime.py':{'SamplingConfig':('__post_init__','route'),'BiasRuntime':('__init__','evaluate','evaluate_masked','commit','state_dict','load_state_dict','_deposits','_write_logs')},
'pydyn/sampling/__init__.py':{},
'pydyn/dynamics/ensembles/verlet.py':{'VelocityVerlet':('__init__',)},
'pydyn/dynamics/ensembles/base.py':{'Ensemble':('step',)},
'pydyn/dynamics/initializer.py':{'MaxwellBoltzmannDistribution':('__init__','initialize')},
'pydyn/neighbors/cuda_neighbor.py':{'CudaNeighborList':('__init__','find_neighbor')},
'pydyn/forces/evaluator.py':{'ForceEvaluator':('from_model',)},
'pydyn/observers.py':{'Observer':('__init__','__call__'),'TableLogger':('__init__','initialize','observe'),'TrajectoryWriter':('__init__','observe')},

}
# Source-only integration contracts, not advice to call internal lifecycle methods.
STATIC_CLASS_ATTRIBUTES={'pydyn/forces/ml.py':{'TorchMLForceModel':('model_dtype','result_dtype')}}
INTEGRATION_METHODS={'Simulation._initialize','Simulation._step','BiasRuntime._deposits','BiasRuntime._write_logs','TorchMLForceModel.cupy_to_model_tensor','Ensemble.step','CudaNeighborList.find_neighbor'}
def selection_size(item):
 description={key:item[key]for key in ('expression','value_present','evaluation')}if item.get('kind')=='static_class_expression'else item.get('fields',[])
 return len(item['code'].encode())+len(json.dumps(description,ensure_ascii=False,separators=(',',':')).encode())

class ApiReadError(ValueError):
 def __init__(self,code,message):self.code=code;super().__init__(message)
def fail(code,message):raise ApiReadError(code,message)
def digest(value):return hashlib.sha256(value).hexdigest()
def read_source(root,name):
 path=root/name;current=root
 for part in Path(name).parts:
  current=current/part
  if current.is_symlink():fail('unsafe_source','Linked source refused')
 if path.resolve()!=path or not path.is_file() or path.stat().st_size>262144:fail('unsafe_source','Public API source unavailable or exceeds256KiB')
 before=path.stat()
 with path.open('rb')as stream:raw=stream.read(262145)
 after=path.stat()
 if len(raw)>262144 or (before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_ino,after.st_size,after.st_mtime_ns):fail('source_changed','Public API source changed during read')
 return path,raw
def git_identity(root):
 try:return source_git_identity(root)
 except (SourceGitError,OSError,ValueError) as error:fail('git_identity_unavailable','Current registered repository Git identity unavailable; no source or receipt repair is automatic')

def extract(name,code,file_sha):
 tree=ast.parse(code);items={};classes={}
 for node in tree.body:
  if isinstance(node,ast.ClassDef) and node.name in METHODS[name]:
   if node.name in classes:fail('ambiguous_symbol','Duplicate public API class')
   classes[node.name]=node
 for cname,allowed in METHODS[name].items():
  cls=classes.get(cname)
  if cls is None:continue
  for field in cls.body:
   target=field.targets[0] if isinstance(field,ast.Assign) and len(field.targets)==1 else field.target if isinstance(field,ast.AnnAssign) else None
   if not isinstance(target,ast.Name) or target.id not in STATIC_CLASS_ATTRIBUTES.get(name,{}).get(cname,()):continue
   key=name+'::'+cname+'.'+target.id
   if key in items:fail('ambiguous_symbol','Duplicate public API identity')
   text=''.join(code.splitlines(keepends=True)[field.lineno-1:field.end_lineno]);value=field.value
   items[key]={'symbol_id':key,'code':text,'expression':ast.get_source_segment(code,value) if value is not None else None,'value_present':value is not None,'evaluation':'not_evaluated','kind':'static_class_expression','source':{'name':name,'sha256':file_sha,'line':field.lineno,'end_line':field.end_lineno},'excerpt_sha256':digest(text.encode()),'partial':True}
  if cname=='SamplingConfig':
   fields=[];lines=[]
   for item in cls.body:
    if isinstance(item,ast.AnnAssign) and isinstance(item.target,ast.Name):
     expression=ast.get_source_segment(code,item.value) if item.value is not None else None
     fields.append({'name':item.target.id,'annotation':ast.get_source_segment(code,item.annotation),'default_present':item.value is not None,'default_expression':expression,'evaluation':'not_evaluated'})
     lines.append(ast.get_source_segment(code,item))
   key=name+'::SamplingConfig';text='\n'.join(lines)
   items[key]={'symbol_id':key,'code':text,'fields':fields,'source':{'name':name,'sha256':file_sha,'line':cls.lineno},'excerpt_sha256':digest(text.encode()),'partial':True}
  for method in cls.body:
   if not isinstance(method,(ast.FunctionDef,ast.AsyncFunctionDef)) or method.name not in allowed:continue
   key=name+'::'+cname+'.'+method.name
   if key in items:fail('ambiguous_symbol','Duplicate public API identity')
   start=min([method.lineno]+[d.lineno for d in method.decorator_list]);text=''.join(code.splitlines(keepends=True)[start-1:method.end_lineno])
   items[key]={'symbol_id':key,'code':text,'source':{'name':name,'sha256':file_sha,'line':start,'end_line':method.end_lineno},'excerpt_sha256':digest(text.encode()),'partial':True}
 for item in items.values():
  qualified=item['symbol_id'].split('::',1)[1]
  if qualified in INTEGRATION_METHODS:item['kind']='integration_contract'
  item['excerpt_utf8_bytes']=len(item['code'].encode());item['selection_utf8_bytes']=selection_size(item)
 return items

def inspect(service,data):
 if not isinstance(data,dict) or set(data)-{'project_id','environment_id','engine','api_symbols'} or not {'project_id','environment_id','engine'}<=set(data):fail('invalid_input','Exact internal selected context required')
 if data['engine']!='pydyn.sampling':fail('invalid_input','Only explicit pydyn.sampling API reads are supported')
 selected=data.get('api_symbols')
 if selected is not None and (not isinstance(selected,list) or not 1<=len(selected)<=4 or any(not isinstance(x,str) or len(x)>256 or not re.fullmatch(r'[A-Za-z0-9_/]+\.py::[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?',x) for x in selected) or len(set(selected))!=len(selected)):fail('invalid_input','Use1..4 unique exact advertised symbol IDs')
 project=copy.deepcopy(service.store.get('project',data['project_id']));env=copy.deepcopy(service.store.get('environment',data['environment_id']))
 if env['id']not in project['policy']['environments']:fail('access_denied','Environment is not authorized for this current project')
 guide=RuntimeGuides(service.root/'runtime-guides');receipt=guide.read(env,'pydyn.sampling')
 if receipt.get('status')!='observed':fail('observed_runtime_required','Current observed exact-environment pydyn.sampling receipt required; use a separately authorized normal environment check')
 facts=receipt['facts'];cap=facts.get('capabilities',{}).get('pydyn_sampling',{});root=Path(env.get('repositories',{}).get('pydyn','')).absolute()
 if not root.is_dir() or root.resolve()!=root or not facts.get('python',{}).get('registration_match') or cap.get('available')is not True:fail('runtime_origin_mismatch','Selected registered sampling origin is not observed')
 origin=Path(cap.get('origin','')).absolute();module=Path(facts.get('modules',{}).get('pydyn',{}).get('file','')).absolute()
 if origin!=root/'pydyn/sampling/__init__.py' or not module.is_relative_to(root/'pydyn') or facts.get('modules',{}).get('pydyn',{}).get('registration_match')is not True:fail('runtime_origin_mismatch','Imported sampling and core origins must match this registered target')
 if facts.get('sampling_provenance',{}).get('status')!='observed' or receipt.get('api_provenance',{}).get('status')!='observed':fail('api_provenance_observation_missing','Strict API JSON attestation is missing or stale; ordinary module capability is separate. Review public provenance and obtain a normal explicit check when appropriate, not installation')
 provenance=sampling_provenance(env)
 if facts['sampling_provenance']!=provenance:fail('source_changed','Observed sampling JSON provenance changed')
 observed_git=facts.get('repositories',{}).get('pydyn',{})
 if observed_git.get('status')!='passed' or not isinstance(observed_git.get('dirty'),bool) or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}',str(observed_git.get('commit',''))):fail('source_git_observation_missing','Observed selected repository Git identity is missing; obtain a separately authorized normal environment check after source access is supported, never fabricate or repair a receipt')
 git=git_identity(root)
 if git['commit']!=observed_git.get('commit') or git['dirty']!=observed_git.get('dirty'):fail('git_identity_changed','Observed selected repository Git identity changed')
 observations={x['path']:x for x in facts.get('file_observations',[])};files=[];items={};total=sum(x["size"]for x in provenance["files"])
 for name in METHODS:
  path,raw=read_source(root,name);total+=len(raw)
  if total>2097152:fail('input_budget','Fixed API source input exceeds2MiB')
  file_sha=digest(raw);watch=observations.get(str(path))
  if not watch or watch.get('sha256')!=file_sha:fail('api_source_observation_missing','API body lacks the exact observed file identity; request a normal explicit environment check')
  code=raw.decode('utf8');files.append({'name':name,'size':len(raw),'sha256':file_sha});new=extract(name,code,file_sha)
  if items.keys()&new.keys():fail('ambiguous_symbol','Duplicate public API identity')
  items.update(new)
 if selected is not None and any(k not in items for k in selected):fail('unsupported_symbol','Unknown or stale ID; read this target index and request only advertised methods')
 index=[{k:v for k,v in item.items() if k not in ('code','fields','expression')} for item in items.values()]
 result={'status':'passed','partial':True,'environment_id':env['id'],'engine':'pydyn.sampling','configuration_sha256':fingerprint(env),'observed_receipt_sha256':receipt['receipt'],'observed_at':facts.get('observed_at'),'root_identity_sha256':digest(str(root).encode()),'imported_origins_match':True,'repository':git,'provenance':provenance,'files':files,'api':index,'limits':{'max_symbols':4,'max_excerpt_utf8_bytes':16384,'partial':True},'scope':'Fixed integration-contract excerpts and static class expressions are source only, not runtime dtype evidence or instructions to call internal lifecycle methods. This exact selected environment public API only; no global fallback, import, execution, job authorization or numerical validation.'}
 if len(json.dumps(result,ensure_ascii=False).encode())>32768:fail('metadata_budget','API index metadata exceeds32KiB')
 if selected is not None:
  excerpts=[items[k]for k in selected];size=sum(selection_size(item)for item in excerpts)
  if size>16384:fail('excerpt_budget','Selected source/default descriptions exceed16KiB; request fewer IDs, nothing truncated')
  result['api_excerpts']={'symbols':excerpts,'bytes':size,'evaluation':'not_evaluated','partial':True}
 if service.store.get('project',project['id'])!=project or service.store.get('environment',env['id'])!=env or guide.read(env,'pydyn.sampling')!=receipt or git_identity(root)!=git:fail('source_changed','Selected context or source changed during read')
 return result
