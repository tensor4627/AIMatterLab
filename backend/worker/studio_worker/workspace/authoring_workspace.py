"""Desktop-owned draft workspaces. Never grants calculation authorization."""
import hashlib
import shutil
from pathlib import Path
from studio_worker.infrastructure.util import leaf, contained, digest
from studio_worker.tools.engine_contracts import CONTRACTS

def ensure(service, data):
 key=leaf(data['workspace_id']);projects=service.store.list('project');project=next((p for p in projects if p['id']==data.get('project_id')),None)
 if project and project.get('authoring_only') and not project.get('studio_workspace') and project.get('authoring_task_id')!=key:project=None
 if project is None:
  identifier='draft-'+key;project=next((p for p in projects if p['id']==identifier),None)
  if project and project.get('authoring_task_id')!=key:raise PermissionError('Draft workspace identity mismatch')
  if project is None:
   root=service.root/'projects'/identifier/'inputs'
   project=service.register_project({'id':identifier,'name':'草稿 · '+str(data.get('name') or key).splitlines()[0][:28],'authoring_only':True,'authoring_task_id':key,'policy':{'engines':[],'gpus':[0],'max_seconds':3600,'max_concurrent':1,'input_roots':[str(root)],'environments':[e['id'] for e in service.store.list('environment') if e.get('executables',{}).get('python')],'clusters':[]}})
 if project.get('authoring_only') and (project.get('authoring_task_id')==key or project.get('studio_workspace')):
  # Authoring interpreter access is distinct from engines, queues or resource grants.
  available=[e['id'] for e in service.store.list('environment') if e.get('executables',{}).get('python')]
  if project['policy']['environments']!=available:
    project['policy']['environments']=available;project=service.store.put('project',project)
 root=contained(service.root/'projects'/project['id']/'inputs',[service.root]);root.mkdir(parents=True,exist_ok=True)
 imported=[]
 structures=data.get('structure_paths',[]);selected=data.get('selected_paths',[])
 if not isinstance(structures,list) or len(structures)>16 or not isinstance(selected,list) or len(selected)>64:raise ValueError('Bounded explicit input paths required')
 paths=list(dict.fromkeys(structures+selected));total=0
 for name in paths:
  path=Path(name)
  structure=path.suffix.lower() in ('.xyz','.extxyz','.cif','.pdb','.vasp') or path.name=='POSCAR'
  scientific=path.suffix.lower() in ('.txt','.pt','.pt2','.pth','.ckpt','.yaml','.yml','.json','.in','.py','.toml','.dat','.out')
  if not path.is_absolute() or not structure and (name not in selected or not scientific):raise ValueError('Explicit scientific input file required')
  if path.suffix.lower()=='.out':
   if any(part.casefold()=='skills' for part in (*path.parts,*path.resolve().parts)):raise ValueError('Skill-directory paths are not automatic scientific output inputs')
   # New output imports use project read roots; known foreign runs never become implicit inputs.
   resolved=path.resolve();runs=service.store.runs()
   if any(r['project_id']!=project['id'] and (resolved==Path(r['directory']).resolve() or Path(r['directory']).resolve() in resolved.parents) for r in runs):raise ValueError('Other-project run output is not an automatic input')
   contained(path,project['policy']['input_roots']+[str(root)]+[r['directory'] for r in runs if r['project_id']==project['id']])
  if not path.is_file():imported.append({'source':str(path),'status':'blocked','reason':'File does not exist'});continue
  total+=path.stat().st_size
  if path.is_symlink() or path.stat().st_size>512*1024*1024 or total>1024*1024*1024:raise ValueError('Input must be a bounded regular file')
  sha=digest(path)
  if path.resolve().is_relative_to(root.resolve()):
   imported.append({'source':str(path),'path':str(path),'sha256':sha,'status':'passed','scope':'Already owned project input'});continue
  folder=contained(root/('import-'+sha[:16]),[root]);folder.mkdir(parents=True,exist_ok=True)
  target=contained(folder/leaf(path.name),[root])
  from studio_worker.workspace.private_lineage import propagate
  propagate(service,[str(path)],project['id'])
  if not target.exists():shutil.copyfile(path,target)
  if digest(target)!=sha:raise ValueError('Imported structure hash mismatch')
  imported.append({'source':str(path),'path':str(target),'sha256':sha,'status':'passed','scope':'Copied explicit user input; scientific validation not yet performed'})
  service.store.put('artifact',{'id':'import-'+project['id']+'-'+sha[:16],'project_id':project['id'],'name':target.name,'path':str(target),'kind':'structure' if structure else 'input','sha256':sha,'size':target.stat().st_size,'metadata':{'source':str(path),'validation':{'status':'not_run','scope':'Explicit user file copied; scientific/format validation not yet run'}}})
 environments=[e for e in service.store.list('environment') if e['id'] in project['policy']['environments'] and e.get('executables',{}).get('python')]
 environments.sort(key=lambda e:(not any(w in (e['id']+' '+e['name']).lower() for w in ('authoring','编写')),not bool(e.get('repositories',{}).get('pygas')),e['id']))
 assets=[a for a in service.store.list('artifact') if a.get('project_id')==project['id']]
 inputs=[]
 for p in root.glob('**/*'):
  if len(inputs)>=64:break
  if p.is_file() and not p.is_symlink() and len(p.relative_to(root).parts)<=4 and p.resolve().is_relative_to(root.resolve()):inputs.append({'path':str(p),'name':str(p.relative_to(root)),'size':p.stat().st_size})
 return {'engine_contracts':CONTRACTS,'inputs':inputs,'project':project,'input_root':str(root),'environment_id':environments[0]['id'] if environments else None,'environments':[{'id':e['id'],'name':e['name'],'repositories':e.get('repositories',{}),'runtime_validation':'not_run'} for e in environments],'imports':imported,'assets':[{'id':a['id'],'path':a['path'],'kind':a['kind'],'name':a['name']} for a in assets],'execution_authorized':False if project.get('authoring_only') else None}

def adopt(service,data):
 source=service.store.get('project',data['source_project_id']);target=service.store.get('project',data['target_project_id'])
 paths=data['paths']
 if not isinstance(paths,list) or not paths or len(paths)>64:raise ValueError('Bounded input list required')
 if source['id']==target['id']:return {'paths':{p:p for p in paths}}
 root=contained(service.root/'projects'/source['id']/'inputs',[service.root]);mapping={}
 for value in paths:
  file=Path(value)
  try:file=contained(file,[root])
  except (ValueError,PermissionError):mapping[value]=value;continue # Target authorization still applies during prepare.
  if not file.is_file() or file.is_symlink():raise ValueError('Regular draft input required')
  sha=digest(file);folder=contained(service.root/'projects'/target['id']/'inputs'/('adopt-'+sha[:24]),[service.root]);folder.mkdir(parents=True,exist_ok=True)
  dest=contained(folder/leaf(file.name),[folder])
  from studio_worker.workspace.private_lineage import propagate
  propagate(service,[str(file)],target['id'])
  shutil.copyfile(file,dest)
  if digest(dest)!=sha:raise ValueError('Adopted input changed')
  mapping[value]=str(dest)
 return {'paths':mapping,'scope':'Desktop input copy only; target authorization and submission gates unchanged'}
