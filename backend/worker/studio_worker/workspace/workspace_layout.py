"""Human-selected, named authoring workspaces. No engine grants or execution."""
import os
import re
import shutil
from pathlib import Path
from studio_worker.infrastructure.util import contained, digest, atomic_json, leaf

LAYOUT=['assets/structures','assets/models','datasets','pygas/definitions','pygas/biases','pygas/analysis','pydyn/inputs','pydyn/runs','gpumd/inputs','gpumd/runs','nep/training','nep/evaluation','hotpp/training','hotpp/evaluation','torchnep/training','reports']

def _root(service,project):
 root=service.root/'projects'/leaf(project['id'])/'inputs'
 if root.resolve()!=root or any(p.is_symlink() for p in [root,*root.parents]):raise ValueError('Workspace must not use a symlink root')
 return root

def describe(service,project):
 if not project.get('studio_workspace'):raise ValueError('A registered Studio workspace is required')
 return {'id':project['id'],'name':project['name'],'root':str(_root(service,project)),'directories':LAYOUT,'asset_mode':project['studio_workspace']['asset_mode'],'assets':service.store.list('workspace-asset') and [a for a in service.store.list('workspace-asset') if a['project_id']==project['id']]}

def create(service,data):
 identifier=leaf(data['id']);name=data['name'];mode=data['asset_mode']
 if not identifier.startswith('workspace-') or not re.fullmatch(r'[a-zA-Z0-9_-]{3,80}',identifier) or not isinstance(name,str) or not name.strip() or len(name)>80 or mode not in ('copy','link'):raise ValueError('Invalid workspace settings')
 previous=next((p for p in service.store.list('project') if p['id']==identifier),None)
 if previous:
  if not previous.get('studio_workspace') or previous['name']!=name:raise ValueError('Workspace identity already belongs to a different project')
  return describe(service,previous)
 root=service.root/'projects'/identifier/'inputs'
 if any(p.is_symlink() for p in [root,*root.parents]):raise ValueError('Workspace parent must not be a symlink')
 root.mkdir(parents=True,exist_ok=True)
 if root.resolve()!=root or any(root.iterdir()):raise ValueError('Choose a new empty workspace; existing files will not be replaced')
 for directory in LAYOUT:(root/directory).mkdir(parents=True)
 atomic_json(root/'studio-workspace.json',{'schema_version':1,'name':name,'directories':LAYOUT,'asset_mode':mode})
 project=service.register_project({'id':identifier,'name':name,'authoring_only':True,'studio_workspace':{'schema_version':1,'asset_mode':mode},'policy':{'engines':[],'gpus':[0],'max_seconds':3600,'max_concurrent':1,'input_roots':[str(root)],'environments':[e['id'] for e in service.store.list('environment') if e.get('executables',{}).get('python')],'clusters':[]}})
 return describe(service,project)

def import_asset(service,data):
 project=service.store.get('project',data['project_id']);root=_root(service,project)
 if not project.get('studio_workspace'):raise ValueError('A registered workspace is required')
 source=Path(data['source']);mode=data.get('mode',project['studio_workspace']['asset_mode'])
 previous=next((a for a in service.store.list('workspace-asset') if a['project_id']==project['id'] and a['path']==str(source)),None)
 if previous:
  if source.is_file() and digest(source)==previous['sha256']:return previous
  raise ValueError('Registered workspace input changed; review its new contents before import')
 if not source.is_absolute() or not source.is_file() or source.is_symlink() or source.stat().st_size>512*1024*1024 or mode not in ('copy','link'):raise ValueError('Select a bounded regular source file and copy/link mode')
 source=source.resolve();sha=digest(source);identifier=project['id']+'-'+mode+'-'+sha
 old=next((a for a in service.store.list('workspace-asset') if a['id']==identifier),None)
 if old:
  target=Path(old['path'])
  if target.is_file() and digest(target)==sha:return old
  raise ValueError('Registered workspace asset changed; import a new version explicitly')
 role=data.get('role','structure')
 folders={'structure':'assets/structures','model':'assets/models','dataset':'datasets','bias':'pygas/biases','input':'gpumd/inputs'}
 engine=str(data.get('engine','gpumd')).split('.')[0]
 if role=='input':folders['input']={'pydyn':'pydyn/inputs','gpumd':'gpumd/inputs','pygas':'pygas/definitions','nep':'nep/training','hotpp':'hotpp/training','torchnep':'torchnep/training'}.get(engine,'gpumd/inputs')
 if role not in folders:raise ValueError('Unknown asset role')
 folder=root/folders[role]
 if folder.resolve()!=folder:raise ValueError('Asset folder must not be a symlink')
 target=folder/(sha[:12]+('-ref-' if mode=='link' else '-')+leaf(source.name))
 if target.exists() or target.is_symlink():raise ValueError('An unregistered target already exists; it will not be overwritten')
 if mode=='link':os.symlink(str(source),str(target))
 else:
  with source.open('rb') as inp,target.open('xb') as out:shutil.copyfileobj(inp,out,1024*1024)
 if digest(source)!=sha or digest(target)!=sha:raise ValueError('Asset changed during import; unconfirmed output retained for inspection')
 from studio_worker.workspace.private_lineage import propagate
 propagate(service,[str(source)],project['id'])
 if mode=='link' and str(source) not in project['policy']['input_roots']:
  project['policy']['input_roots'].append(str(source));service.store.put('project',project)
 asset={'id':identifier,'project_id':project['id'],'name':source.name,'path':str(target),'source':str(source),'sha256':sha,'role':role,'mode':mode,'validation':{'status':'not_run','scope':'Asset identity only; no format, model or scientific validation'}}
 return service.store.put('workspace-asset',asset)

def retain_inputs(service,data):
 project=service.store.get('project',data['project_id']);_root(service,project)
 if not project.get('studio_workspace'):raise ValueError('A registered workspace is required')
 previous=service.store.get('project',data['previous_project_id']);sources=data.get('sources',[])
 if not isinstance(sources,list) or len(sources)>64:raise ValueError('Bounded current workflow inputs required')
 allowed=previous['policy']['input_roots']+[str(service.root/'projects'/previous['id']/'inputs')]
 for source in sources:
  file=contained(source,allowed)
  if not file.is_file():raise ValueError('Current workflow input is unavailable')
  from studio_worker.workspace.private_lineage import propagate
  propagate(service,[str(file)],project['id'])
  if str(file) not in project['policy']['input_roots']:project['policy']['input_roots'].append(str(file))
 service.store.put('project',project)
 return describe(service,project)
