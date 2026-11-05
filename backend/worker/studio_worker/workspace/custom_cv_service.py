from studio_worker.compute.custom_cv_check import CustomCvCheckMixin
from studio_worker.infrastructure.paths import WORKER_ROOT
"""Conversation-owned private CV controller. Desktop admin actions only.
The separate CPU primitive consent never changes project engine/GPU authorization.
"""
import copy,hashlib,json,os,re,secrets,subprocess,sys,threading,time
from pathlib import Path
from studio_worker.workspace.custom_cv_registry import Registry
from studio_worker.tools.custom_formula import sha,stable,referenced_atoms,fd_atoms,parameter_values
from studio_worker.tools.custom_cv_catalog import checked_entry
from studio_worker.tools.custom_cv_numerics import bounded_bytes

class CustomCvService(CustomCvCheckMixin):
 def __init__(self,service):
  self.service=service;self.lock=threading.RLock();self.library=Registry(service.root/'custom-cv-library')
 def context(self,data):
  from studio_worker.workspace.pygas_composition import context,location,assets,resolve_input
  from studio_worker.workspace.composition_store import CompositionStore
  project,environment,source,root=context(self.service,data)
  workspace=data.get('workspace_id')
  if not isinstance(workspace,str)or not re.fullmatch('[A-Za-z0-9_.-]{1,128}',workspace)or workspace in ('.','..'):raise ValueError('Explicit owned authoring workspace required')
  directory=location(root,{'workspace_id':workspace})
  if data.get('composition_path') and Path(data['composition_path']).absolute()!=directory/'workflow.json':raise ValueError('Only this conversation owned composition can host its custom CV')
  state=CompositionStore(root,self.service.store.lock).read(directory)
  value=(state.get('graph')or{}).get('settings',{}).get('atoms_path')or data.get('structure_path')
  if not value:
   selected=data.get('files',[])
   if not isinstance(selected,list)or len(selected)>256 or any(not isinstance(item,str)or not item or len(item)>4096 or any(ord(c)<32 for c in item)for item in selected):raise ValueError('Current workflow files must be a bounded list of exact selected paths')
   candidates={item['path']for item in assets(self.service,project,root)if item.get('kind')=='structure'and item.get('path')in selected}
   if len(candidates)>1:raise ValueError('Several selected structure assets are available; choose one explicit structure for this custom CV')
   if candidates:value=next(iter(candidates))
  structure=None
  if value:
   path=resolve_input(value,directory,assets(self.service,project,root),root,project)
   raw=bounded_bytes(path,4*1024*1024);structure={'id':'selected-'+hashlib.sha256(raw).hexdigest(),'name':path.name,'path':str(path),'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw)}
  runtime=self.service.read_runtime_guide({'environment_id':environment['id'],'engine':'pygas.build'})
  return {'project':project,'environment':environment,'source':source,'root':root,'workspace':workspace,'directory':directory,'pair':state,'structure':structure,'runtime':runtime}
 def owned(self,data,ctx):
  item=self.library.read(data['id'])
  if item['project_id']!=ctx['project']['id']or item['workspace_id']!=ctx['workspace']:raise PermissionError('Reuse this library item explicitly into the current conversation first')
  return item
 def references(self,ctx):
  result=[]
  for asset in self.service.store.list('artifact'):
   if asset.get('project_id')==ctx['project']['id']and str(asset.get('name','')).endswith('.cv-reference.json'):
    result.append({k:asset.get(k)for k in('id','name','sha256','kind')})
  return result[:128]
 def independent(self,ctx,data,item):
  identifier=data.get('reference_asset_id')
  if not identifier:return None
  from studio_worker.workspace.pygas_composition import assets,resolve_input
  available=assets(self.service,ctx['project'],ctx['root']);asset=next((a for a in available if a['id']==identifier),None)
  if not asset or not asset['name'].endswith('.cv-reference.json'):raise ValueError('Choose a registered independent .cv-reference.json asset')
  path=resolve_input(asset['path'],ctx['directory'],available,ctx['root'],ctx['project']);raw=bounded_bytes(path,65536)
  if hashlib.sha256(raw).hexdigest()!=asset.get('sha256'):raise ValueError('Reference asset changed; explicitly reimport it')
  value=json.loads(raw)
  if set(value)!={'schema_version','kind','cv','structure_sha256','spec_sha256','parameters_sha256','provenance'}or value['schema_version']!=1 or value['kind']!='independent_cv_reference':raise ValueError('Independent reference schema required')
  if value['structure_sha256']!=ctx['structure']['sha256']or value['spec_sha256']!=item['spec_sha256']or value['parameters_sha256']!=item['parameters_sha256']:raise ValueError('Reference must describe this exact formula and actual structure')
  provenance=value['provenance']
  if not isinstance(provenance,dict)or provenance.get('kind')!='declared_independent_method'or not isinstance(provenance.get('method'),str)or not 8<=len(provenance['method'])<=2000:raise ValueError('Describe the separately justified independent method; generated self-check values do not count')
  import math
  if not isinstance(value['cv'],list)or len(value['cv'])!=item['spec']['output_size']or any(type(v)not in(int,float)or not math.isfinite(v)for v in value['cv']):raise ValueError('Finite exact-width independent CV reference required')
  return {'cv':value['cv'],'provenance':{**provenance,'asset_id':identifier,'sha256':asset['sha256'],'parameters_sha256':item['parameters_sha256'],'provenance_status':'External declared method; exact values/method/hash require explicit adoption in the native CPU-check confirmation, implementation not independently audited'}}
 def scope(self,ctx,data,item):
  if not item.get('code_approval')or item.get('missing_parameters'):return None
  if not ctx['structure']or ctx['runtime'].get('status')!='observed':return None
  from studio_worker.infrastructure.util import run_json
  from studio_worker.tools.adapters import SCIENTIFIC,process_env
  report=run_json(ctx['environment']['executables']['python'],SCIENTIFIC,'structure',{'path':ctx['structure']['path'],'frame':0},process_env(ctx['environment']),timeout=20)
  count=report.get('n_atoms',report.get('natoms'))
  if type(count)is not int or not 1<=count<=256:raise ValueError('Primitive authoring checks require an actual 1..256 atom structure')
  values,missing=parameter_values(item['spec'],item['parameter_values'],complete=True)
  atoms=referenced_atoms(item['spec'],values,count)
  if not atoms:raise ValueError('Formula must reference actual atoms')
  reference=self.independent(ctx,data,item)
  facts=ctx['runtime']['facts'];python=facts.get('python',{}).get('executable')
  if not isinstance(python,str)or Path(python).resolve()!=Path(ctx['environment']['executables']['python']).resolve()or facts.get('python',{}).get('registration_match')is not True:raise ValueError('Selected interpreter differs from its actual runtime receipt')
  result={'schema_version':1,'kind':'human_custom_cv_cpu_check','workspace_id':ctx['workspace'],'project_id':ctx['project']['id'],'environment_id':ctx['environment']['id'],'id':item['id'],'revision':item['revision'],'bindings':{**{k:item[k]for k in('spec_sha256','code_sha256','parameters_sha256')},'structure_sha256':ctx['structure']['sha256'],'runtime_receipt_sha256':ctx['runtime']['receipt']},'python':python,'interpreter':python,'structure_asset_id':ctx['structure']['id'],'device':'cpu','max_seconds':60,'max_output_bytes':8*1024*1024,'fd_atom_indices':fd_atoms(atoms),'reference_asset_id':data.get('reference_asset_id'),'reference':reference or {'kind':'exact_AST_independent_ASE_if_supported; otherwise_reuse_blocked'},'scope':'One saved primitive CPU check only. No GPU, bias build, MD, installation, environment switch or project authorization change. Stable-phase/physical and consuming-target checks remain separate.'}
  from studio_worker.tools.custom_reference import pair_formula
  pair=pair_formula(item['spec'],values);cell=report.get('cell',[]);pbc=report.get('pbc',[])
  orthogonal=len(cell)==3 and all(len(row)==3 for row in cell) and all(abs(sum(cell[i][k]*cell[j][k]for k in range(3)))<=1e-10 for i in range(3)for j in range(3)if i!=j)
  auto=pair and(not pair['periodic']or all(pbc)and len(pbc)==3 and orthogonal)
  result['reference_kind']='external-declared'if reference else'ase-distance'if auto else'independent_reference_required'
  result['reference_source']=reference['provenance']if reference else{'kind':'independent_ASE_selected_distance'}if auto else{'status':'not_run','reason':'No applicable independently justified reference; self-consistency cannot establish reuse'}
  result['sha256']=sha(result);return result
 def read(self,data):
  with self.lock:
   ctx=self.context(data);item=self.owned(data,ctx)if data.get('id')else None
   result={'entry':item,'entries':[{k:v for k,v in a.items()if k not in('formula_approval','code_approval','numerical')}for a in self.library.list()],'runtime':{'status':ctx['runtime']['status'],'receipt_sha256':ctx['runtime'].get('receipt'),'interpreter':ctx['runtime'].get('facts',{}).get('python',{}).get('executable'),'reason':ctx['runtime'].get('reason')},'structure':{k:v for k,v in(ctx['structure']or{}).items()if k!='path'}or None,'reference_assets':self.references(ctx)}
   result['entries']=[{**entry,'expected':{k:entry.get(k)for k in('spec_sha256','code_sha256','parameters_sha256','revision')}}for entry in result['entries']]
   result['capabilities']={'approve_formula':True,'approve_code':True,'validate':True,'sharing':True,'reuse':True,'attach':True,'parameter_types':['number','integer','number_vector','integer_vector','number_matrix'],'expression_functions':['norm','sum','mean','sqrt','exp','log','sin','cos','abs','atan2','dot','cross','clamp','stack','mic','logsumexp']}
   review=next((record for record in self.service.store.list('custom-cv-review')if item and record['id']==item['id']and record['spec_sha256']==item['spec_sha256']),None)
   result['library_review']=copy.deepcopy(review['review'])if review else None
   result['numeric_scope']=self.scope(ctx,data,item)if item else None
   return result
 def review_library(self,ctx,review):
  from studio_worker.tools.pygas_catalog import catalog
  receipt=catalog(ctx['source'])
  if not isinstance(review,dict)or review.get('source_files')!=receipt['source']['files']:raise ValueError('Inspect the actual registered CV library before proposing a missing definition')
  names=review.get('classes');actual={x['name']for x in receipt['catalog']['cv']}
  if not isinstance(names,list)or not 1<=len(names)<=8 or any(n not in actual for n in names):raise ValueError('Record 1..8 actually inspected library CV class names')
  if not isinstance(review.get('reason'),str)or not 12<=len(review['reason'])<=2000:raise ValueError('Explain the scientific missing/non-equivalent definition before human formula confirmation')
  return copy.deepcopy(review)
 def save(self,data):
  with self.lock:
   ctx=self.context(data);review=self.review_library(ctx,data.get('library_review'))
   if data.get('id'):self.owned(data,ctx)
   item=self.library.propose(data['spec'],data.get('values',{}),workspace_id=ctx['workspace'],project_id=ctx['project']['id'],identifier=data.get('id'),expected=data.get('expected'))
   self.service.store.put('custom-cv-review',{'id':item['id'],'spec_sha256':item['spec_sha256'],'review':review})
   return self.read({**data,'id':item['id']})
 def action(self,action,data):
  with self.lock:
   ctx=self.context(data);item=self.owned(data,ctx)
   if action=='approve-formula':
    record=self.service.store.get('custom-cv-review',item['id'])
    if record['spec_sha256']!=item['spec_sha256']:raise ValueError('Current library-first explanation must accompany formula approval')
    self.review_library(ctx,record['review']);self.library.approve_formula(item['id'],data['expected'])
   elif action=='approve-code':self.library.approve_code(item['id'],data['expected'])
   elif action=='sharing':self.library.share(item['id'],data['expected'],data['provider'],data['enabled'])
   else:raise ValueError('Unknown human CV action')
   return self.read(data)

 def reuse(self,data):
  with self.lock:
   ctx=self.context(data);item=self.library.reuse(data['id'],data['expected'],workspace_id=ctx['workspace'],project_id=ctx['project']['id'])
   old=self.service.store.get('custom-cv-review',data['id'])
   self.service.store.put('custom-cv-review',{**old,'id':item['id']})
   return self.read({**data,'id':item['id']})

 def access(self,provider):
  """Metadata-only main guard. Not an MCP tool or an authorization mutation."""
  if provider not in('codex','kimi','qwen','deepseek','compatible',None):raise ValueError('Unknown private provider scope')
  from studio_worker.workspace.private_lineage import current_rows
  projects={};bindings=[];entries={};blocked_paths=[]
  def allowed(version):
   try:
    identifier=version['entry_id']
    if identifier not in entries:entries[identifier]=self.library.read(identifier)
    entry=entries[identifier]
    return bool(provider and entry.get('sharing',{}).get(provider)and all(version.get(key)==entry.get(key)for key in('spec_sha256','code_sha256','parameters_sha256')))
   except(ValueError,OSError,KeyError):return False
  rows=current_rows(self.service)
  for record in rows:
   permitted=allowed({'entry_id':record['entry_id'],**record['bindings']})
   if not permitted:projects[record['project_id']]=True
   bindings.append({'workspace_id':record['workspace_id'],'project_id':record['project_id'],'entry_id':record['entry_id'],'allowed':permitted,'bindings':record['bindings'],'paths':record['paths']})
  runs=[]
  for run in self.service.store.runs():
   versions=run.get('private_cv_versions')
   # Historical runs without exact immutable version metadata fail closed.
   denied=any(not allowed(version)for version in versions)if versions else bool(run.get('private_cv_entries')or run['project_id']in projects or any(row['project_id']==run['project_id']for row in rows))
   if denied:runs.append(run['id']);blocked_paths.append(run['directory'])
  for run in self.service.store.list('cluster-run'):
   if run.get('project_id')in projects or any(row['project_id']==run.get('project_id')for row in rows):runs.append(run['id'])
  for project_id,workspace_id in {(row['project_id'],row['workspace_id'])for row in rows}:
   directory=self.service.root/'projects'/project_id/'inputs'/('cv-'+workspace_id)
   known={row['bindings'].get('code_sha256')for row in rows if row['project_id']==project_id and row['workspace_id']==workspace_id}
   for index,path in enumerate(directory.glob('studio_custom_*.py')):
    if index>=256:projects[project_id]=True;break
    if path.name.removeprefix('studio_custom_').removesuffix('.py')not in known:blocked_paths.append(str(path))
  return {'blocked_project_ids':sorted(projects),'blocked_run_ids':sorted(set(runs)),'blocked_paths':sorted(set(blocked_paths)),'bindings':bindings,'scope':'Current exact private entry/provider version only. Old code/parameter versions and historical runs receive no new grant; revoked or mismatched versions remain blocked. Revocation cannot erase already shared provider history.'}

 def provider_status(self,data,body=False):
  with self.lock:
   ctx=self.context(data);item=self.owned(data,ctx);provider=data.get('provider')
   if provider not in('codex','kimi','qwen','deepseek','compatible'):raise PermissionError('A current provider scope is required')
   allowed=item.get('sharing',{}).get(provider)is True
   if not allowed:return {'status':'permission_required','allowed':False,'id':item['id'],'scope':'This exact private formula/source is not shared with the selected provider'}
   expected={key:item.get(key)for key in('spec_sha256','code_sha256','parameters_sha256','revision')}
   result={'status':'passed','allowed':True,'id':item['id'],'expected':copy.deepcopy(expected)}
   if body:
    # Provider consent covers this exact definition/values/source, never the admin record.
    result['entry']={key:copy.deepcopy(item[key])for key in('id','workspace_id','project_id','revision','spec_sha256','code_sha256','parameters_sha256','spec','parameter_values','code')if key in item}
    result['entry']['expected']=copy.deepcopy(expected)
   return result
