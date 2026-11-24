"""Detached bounded CPU-check execution; approval/library state remains workspace-owned."""
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

class CustomCvCheckMixin:
 def validate(self,data):
  with self.lock:
   ctx=self.context(data);item=self.owned(data,ctx);self.library._cas(item['id'],data['expected'])
   for existing in self.service.store.list('custom-cv-attempt'):
    if existing['entry_id']!=item['id']or existing['workspace_id']!=ctx['workspace']:continue
    if existing['status']in('running','launching','unknown'):
     observed=self.status({**data,'attempt_id':existing['id']})
     if observed['status']in('running','launching','unknown'):raise ValueError('An existing numerical attempt is running or unknown; reconcile its real exit identity before any new CPU action')
   item=self.owned(data,ctx)
   if item['expected']!=data['expected']:raise ValueError('Numerical revision changed during reconciliation; reload before a new human check')
   scope=self.scope(ctx,data,item)
   if not scope or scope['sha256']!=data.get('numeric_scope_sha256'):raise ValueError('Numerical scope changed; review the actual current CPU scope again')
   action=data.get('human_action_id')
   if not isinstance(action,str)or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',action):raise PermissionError('Exact one-use desktop human action identity required')
   attempt_id=sha({'workspace':ctx['workspace'],'action':action})[:24]
   old=next((r for r in self.service.store.list('custom-cv-attempt')if r['id']==attempt_id),None)
   if old:
    if old['scope_sha256']!=scope['sha256']:raise ValueError('Human action was already bound to a different CPU scope')
    return self.status({**data,'attempt_id':attempt_id})
   from studio_worker.tools.adapters import process_env
   from studio_worker.infrastructure.util import atomic_json
   directory=self.library.root/'numerical'/attempt_id
   directory.mkdir();(directory/'simulation').mkdir();(directory/'results').mkdir()
   snapshot=directory/'simulation';code=bounded_bytes(self.library.root/'sources'/(item['code_sha256']+'.py'),65536);structure=bounded_bytes(ctx['structure']['path'],4*1024*1024)
   if hashlib.sha256(code).hexdigest()!=item['code_sha256']or hashlib.sha256(structure).hexdigest()!=ctx['structure']['sha256']:raise ValueError('Approved inputs changed before snapshot')
   (snapshot/'primitive.py').write_bytes(code);structure_name='POSCAR'if ctx['structure']['name']=='POSCAR'else'reference'+Path(ctx['structure']['name']).suffix;(snapshot/structure_name).write_bytes(structure)
   consent={k:v for k,v in scope.items()if k not in('sha256','reference','python')};consent['human_action_id']=action;consent['sha256']=sha(consent)
   payload={'spec':item['spec'],'parameter_values':item['parameter_values'],'class_name':item['class_name'],'code_path':str(snapshot/'primitive.py'),'structure_file':str(snapshot/structure_name),'output_dir':str(directory/'results'),'device':'cpu','structure_asset_id':ctx['structure']['id'],'reference_kind':scope['reference_kind'],'consent':consent,**scope['bindings']}
   reference=scope.get('reference')if scope.get('reference_kind')=='external-declared'else None
   if reference:
    reference=copy.deepcopy(reference);reference['provenance']['adoption']={'kind':'explicit_main_native_consent','human_action_id':action,'scope_sha256':scope['sha256']}
    payload.update(cv_reference=reference['cv'],reference_provenance=reference['provenance'])
   raw=stable(payload);(snapshot/'payload.json').write_bytes(raw)
   env=process_env(ctx['environment']);worker_root=str(WORKER_ROOT);env['PYTHONPATH']=worker_root+os.pathsep+env.get('PYTHONPATH','');env['CUDA_VISIBLE_DEVICES']=''
   launch={'command':[scope['python'],'-m','studio_worker.tools.custom_cv_command',str(snapshot/'payload.json'),hashlib.sha256(raw).hexdigest()],'environment':env,'max_seconds':60};atomic_json(directory/'launch.json',launch)
   record={'id':attempt_id,'entry_id':item['id'],'workspace_id':ctx['workspace'],'project_id':ctx['project']['id'],'environment_id':ctx['environment']['id'],'scope_sha256':scope['sha256'],'scope':scope,'consent_sha256':consent['sha256'],'status':'launching','directory':str(directory),'expected':item['expected'],'created_at':time.time()}
   self.service.store.put('custom-cv-attempt',record)
   try:
    child=subprocess.Popen([sys.executable,'-m','studio_worker.runner',str(directory)],cwd=worker_root,env={**os.environ,'PYTHONPATH':worker_root},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    from studio_worker.infrastructure.util import identity
    record.update(status='running',supervisor=identity(child.pid));self.service.store.put('custom-cv-attempt',record)
   except Exception:
    record['status']='unknown';self.service.store.put('custom-cv-attempt',record);raise
   pending={**scope['bindings'],'status':record['status'],'environment_id':ctx['environment']['id'],'structure_asset_id':ctx['structure']['id'],'reason':'Detached CPU primitive check started; no numerical/reference result yet','consent_sha256':consent['sha256'],'stable_phase':{'status':'not_run'},'target_bias_and_MD':{'status':'not_run'}}
   self.library.record_numerical(item['id'],item['expected'],pending)
   return {**self.read(data),'attempt_id':attempt_id,'status':record['status'],'attempt':{'id':attempt_id,'status':record['status'],'scope':scope}}

 def status(self,data):
  with self.lock:
   ctx=self.context(data);item=self.owned(data,ctx)
   records=[r for r in self.service.store.list('custom-cv-attempt')if r['entry_id']==item['id']and r['workspace_id']==ctx['workspace']]
   record=next((r for r in records if r['id']==data.get('attempt_id')),None)if data.get('attempt_id')else max(records,key=lambda r:r['created_at'],default=None)
   if not record:return self.read(data)
   from studio_worker.infrastructure.util import alive
   directory=self.library.root/'numerical'/record['id'];exit_path=directory/'exit.json'
   if exit_path.exists():
    exit_record=json.loads(bounded_bytes(exit_path,16384));path=directory/'results/report.json'
    report=json.loads(bounded_bytes(path,262144))if path.exists()else {'status':'failed','reason':'Supervisor exited without a bounded numerical report',**record['scope']['bindings']}
    if exit_record['exit_code']!=0 and report.get('status')=='passed':raise ValueError('Failed supervisor cannot authorize a passed numerical report')
    if path.exists()and report.get('consent_sha256')!=record['consent_sha256']:raise ValueError('Numerical receipt differs from its exact one-use consent')
    for key,value in record['scope']['bindings'].items():
     if report.get(key)!=value:raise ValueError('Numerical result binding changed: '+key)
    record.update(status=report['status'],exit=exit_record)
    same=all(item.get(key)==record['scope']['bindings'][key]for key in('spec_sha256','code_sha256','parameters_sha256'))
    if same and record.get('report_sha256')!=sha(report):
     self.library.record_numerical(item['id'],item['expected'],report);record['report_sha256']=sha(report)
    elif not same:record['stale']=True
   elif record.get('supervisor')and alive(record['supervisor']):record['status']='running'
   else:
    record['status']='unknown'
    if item.get('numerical',{}).get('status')in('running','queued')and all(item.get(key)==record['scope']['bindings'][key]for key in('spec_sha256','code_sha256','parameters_sha256')):
     self.library.record_numerical(item['id'],item['expected'],{**record['scope']['bindings'],'status':'unknown','reason':'Supervisor identity is unconfirmed and no actual exit receipt exists; reconcile only, never automatically rerun','environment_id':ctx['environment']['id'],'structure_asset_id':ctx['structure']['id'],'stable_phase':{'status':'not_run'},'target_bias_and_MD':{'status':'not_run'}})
   self.service.store.put('custom-cv-attempt',record)
   return {**self.read(data),'attempt':{k:v for k,v in record.items()if k not in('directory','supervisor')},'status':record['status']}
