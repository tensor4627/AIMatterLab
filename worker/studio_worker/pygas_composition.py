"""Actual source-driven pyGAS composition authoring; no model build or calculation."""
import copy,hashlib,json,os,secrets,shutil,tempfile
from pathlib import Path
from .composition_store import CompositionStore,encoded
from .pygas_catalog import catalog
from .pygas_values import compiler_graph,normalize_graph
from .pygas_settings import validate_settings
from .util import contained,digest,leaf,run_json
from .adapters import SCIENTIFIC,process_env


def context(service,data):
 project=service.store.get('project',data['project_id'])
 if data['environment_id'] not in project['policy']['environments']:raise PermissionError('Environment is not authorized')
 environment=service.store.get('environment',data['environment_id'])
 source=service.store.get('source-project',data.get('source_id','pygas'))
 if source['id']!='pygas':raise ValueError('Select the registered pyGAS source')
 root=contained(service.root/'projects'/project['id']/'inputs',[service.root]);root.mkdir(parents=True,exist_ok=True)
 return project,environment,source,root


def location(root,data):
 path=data.get('path')
 if path:
  raw=Path(path)
  if raw.name!='workflow.json' or raw.is_symlink():raise ValueError('Select the owned workflow.json')
  directory=raw.parent
 else:
  workspace=data.get('workspace_id')
  if not isinstance(workspace,str) or len(workspace)>128:raise ValueError('Existing path or conversation workspace_id required')
  directory=root/('cv-'+leaf(workspace))
 return CompositionStore(root,__import__('threading').RLock()).owned(directory)


def identity(state):return {'journal_sha256':state['journal_sha256'],'files':{name:item['sha256'] for name,item in state['files'].items()}}


def assets(service,project,root):
 result=[]
 for item in service.store.list('artifact'):
  if item.get('project_id')!=project['id'] or len(result)>=256:continue
  try:
   path=contained(item['path'],[root,*project['policy']['input_roots']])
   if not path.is_file() or Path(item['path']).is_symlink() or path.stat().st_size>512*1024*1024:continue
   result.append({key:item.get(key) for key in ('id','name','kind')}|{'path':str(path),'sha256':item.get('sha256'),'size':path.stat().st_size,'hash_status':'recorded_metadata_only; selected files are rehashed before snapshot'})
  except (ValueError,OSError,KeyError):continue
 return result


def resolve_input(value,directory,allowed,root,project):
 if not isinstance(value,str) or not value or any(ord(c)<32 for c in value):raise ValueError('Select an authorized project file')
 raw=Path(value)
 if raw.is_absolute():
  path=contained(raw,[root,*project['policy']['input_roots']])
 else:
  local=directory/raw
  if '..' in raw.parts:raise ValueError('Relative composition inputs cannot traverse directories')
  if local.is_symlink() or local.resolve()!=local.absolute():raise ValueError('Linked composition inputs are not supported')
  if local.exists() and not local.is_file():raise ValueError('Bounded ordinary project file required')
  if local.is_file():
   # Saved graph basenames are explicit paths relative to this owned pair.
   # An unrelated project asset with the same basename cannot replace them.
   path=contained(local,[directory])
  else:
   matches={a['path'] for a in allowed if a['name']==value or Path(a['path']).name==value}
   if len(matches)!=1:raise ValueError('Choose one explicit authorized file for '+value)
   path=contained(next(iter(matches)),[root,*project['policy']['input_roots']])
 if raw.is_symlink() or not path.is_file() or path.stat().st_size>512*1024*1024:raise ValueError('Bounded ordinary project file required')
 return path


def snapshot_assets(graph,receipt,directory,allowed,root,project):
 """Only selected/authorized actual files; generated source uses their basenames."""
 result=copy.deepcopy(graph);references=[];settings=result.setdefault('settings',{})
 if settings.get('atoms_path'):references.append((settings,'atoms_path',settings['atoms_path']))
 for node in result['nodes']:
  entry=next((entry for entry in receipt['catalog'].get(node['kind'],[]) if entry['name']==node.get('class_name')),None)
  if entry:
   for p in entry['params']:
    if p.get('editor_hint',{}).get('editor')=='project_file':
     name=p['name'];value=node.get('params',{}).get(name)
     # Optional file defaults are also actual constructor file reads, never ambient cwd.
     if value is None and p.get('default_is_literal'):value=p.get('default_value')
     if value:references.append((node.setdefault('params',{}),name,value))
 selected={};bindings=[];total=0
 if len(references)>32:raise ValueError("Composition supports at most 32 selected input references")
 for owner,key,value in references:
  path=resolve_input(value,directory,allowed,root,project);name=leaf(path.name)
  if name in ('workflow.json','build_bias.py','.studio-composition.json'):raise ValueError('Reserved composition filename')
  total+=path.stat().st_size
  if total>1024*1024*1024:raise ValueError('Selected composition inputs exceed the 1 GiB total budget')
  current=digest(path)
  recorded=next((item for item in allowed if item['path']==str(path)),None)
  if recorded and recorded.get('sha256') and recorded['sha256']!=current:raise ValueError('Selected asset differs from its recorded hash; reimport the intended file')
  if name in selected and selected[name][1]!=current:raise ValueError('Different selected inputs share the same snapshot basename: '+name)
  if (directory/name).is_file() and digest(directory/name)!=current:name=current[:16]+'-'+name
  selected[name]=(path,current);owner[key]=name;bindings.append({'source':str(path),'name':name,'sha256':current})
 directory.mkdir(parents=True,exist_ok=True)
 for name,(path,current) in selected.items():
  target=directory/name
  if target==path:continue
  if target.exists() and digest(target)!=current:raise ValueError('Composition input filename already contains a different asset: '+name)
  fd,temp=tempfile.mkstemp(prefix='.studio-asset-',dir=directory);os.close(fd)
  try:
   shutil.copyfile(path,temp)
   if digest(Path(temp))!=current or digest(path)!=current:raise ValueError('Selected input changed during snapshot')
   os.replace(temp,target)
  finally:
   if os.path.exists(temp):os.unlink(temp)
 return result,bindings


def draft_graph(graph,receipt):
 """Incomplete structured cells remain data; they never enter a renderer."""
 if not isinstance(graph,dict):raise ValueError('Structured graph required')
 normalized=copy.deepcopy(graph);missing=[]
 settings=normalized.setdefault('settings',{})
 if int(normalized.get('version',1))>=2:
  if 'artifact_formats' not in settings:
   selected='aoti' if str(settings.get('pt_path','')).endswith('.pt2') else 'torchscript'
   settings['artifact_formats']=[selected]
   normalized.setdefault('metadata',{}).setdefault('studio_defaults',{})['artifact_formats']={'value':[selected],'source':'Explicit .pt2 selection' if selected=='aoti' else 'Studio portable TorchScript product default; not upstream GUI default'}
  if 'deployment_backend' not in settings and len(settings['artifact_formats'])==1:settings['deployment_backend']=settings['artifact_formats'][0]
 graph=normalized
 if graph.get('parameter_format')=='structured-v1':
  safe=copy.deepcopy(graph)
  def partial(value):return value is None or isinstance(value,list) and (not value or any(partial(item) for item in value))
  for node in safe.get('nodes',[]):
   entry=next((e for e in receipt['catalog'].get(node.get('kind'),[]) if e['name']==node.get('class_name')),None)
   if not entry:continue
   for p in entry['params']:
    name=p['name'];values=node.get('params',{})
    if name not in values or name in ('n_atoms','numbers','atomic_types') or p.get('is_module_param'):continue
    value=values[name]
    actual_none=p.get('default_is_literal') and p.get('default_value') is None and not p.get('required') or None in p.get('editor_hint',{}).get('options',[])
    actual_empty=p.get('default_is_literal') and p.get('default_value')==[] and not p.get('required')
    if (partial(value) and not (value is None and actual_none or value==[] and actual_empty)) or value=='':
     missing.append(node['id']+'.'+name);del values[name]
  settings_definitions={field['key']:field for field in receipt.get('settings_schema',{}).get('fields',[]) if field.get('location')!='graph.mode'}
  for name,definition in settings_definitions.items():
   container=safe.get('settings',{}).get('opes',{}) if name.startswith('opes.') else safe.get('settings',{})
   key=name[5:] if name.startswith('opes.') else name
   if not isinstance(container,dict) or key not in container:continue
   value=container[key];allows_none='source_default' in definition and definition.get('source_default') is None
   if (value is None and not allows_none) or isinstance(value,list) and any(partial(item) for item in value):missing.append('settings.'+name);del container[key]
  compiler_graph(safe,receipt['catalog'],require_complete=False)
  validate_settings(safe.get('settings',{}),receipt.get('settings_schema',{}))
 else:
  normalized=normalize_graph(graph,receipt['catalog'],require_complete=False)
  validate_settings(normalized.get('settings',{}),receipt.get('settings_schema',{}))
 for node in normalized['nodes']:
  if node.get('kind')=='reduce'and node.get('params',{}).get('operation')in(None,''):missing.append(node['id']+'.operation')
  entry=next((e for e in receipt['catalog'].get(node['kind'],[]) if e['name']==node.get('class_name')),None)
  if entry:
   for p in entry['params']:
    if p['name'] in ('n_atoms','numbers','atomic_types') or p.get('is_module_param'):continue
    if p.get('required') and (p['name'] not in node.get('params',{}) or node['params'].get(p['name'])==''):missing.append(node['id']+'.'+p['name'])
 for field in receipt.get('settings_schema',{}).get('fields',[]):
  name=field['key']
  if not field.get('required') or name.startswith('opes.') and normalized.get('mode',normalized.get('settings',{}).get('mode'))!='opes':continue
  container=normalized.get('settings',{}).get('opes',{}) if name.startswith('opes.') else normalized.get('settings',{})
  key=name[5:] if name.startswith('opes.') else name
  if key not in container:missing.append('settings.'+name)
 for key in ('atoms_path','pt_path'):
  if not normalized.get('settings',{}).get(key):missing.append('settings.'+key)
 return normalized,list(dict.fromkeys(missing))



def readonly_render_checks(graph,state,receipt,derived,source,directory):
 """Recheck saved definitions against current source without importing/rendering it.

 The upstream compiler validated the saved pair originally. This check can only
 withdraw readiness; it never issues new scientific or runtime evidence.
 """
 from .pygas_dimensions import validate_dimensions
 if receipt.get('ports',{}).get('status')!='passed' or receipt.get('settings_schema',{}).get('status')!='passed':raise ValueError('Current source/port/settings contract is not matched; rerender and review required')
 compiled=compiler_graph(graph,receipt['catalog'])
 collectors=[n['id'] for n in compiled['nodes'] if n.get('kind')=='collect']
 if len(collectors)!=1:raise ValueError('Saved graph needs one actual CV collector')
 nodes={n['id']:n for n in compiled['nodes']};size=0
 for edge in compiled.get('edges',[]):
  if edge.get('target')!={'node':collectors[0],'port':'value'}:continue
  node=nodes.get(edge.get('source',{}).get('node'),{});kind=node.get('kind')
  entry=next((e for e in receipt['catalog'].get(kind,[]) if e['name']==node.get('class_name')),None)
  width=1 if kind=='reduce' else entry.get('output_size') if entry and kind=='cv' else None
  if type(width)is not int or width<1:raise ValueError('Saved collector dimension is not established by the current actual source')
  size+=width
 validate_dimensions(compiled,receipt,{'cv_size':size},derived.get('values') or None)
 text=state.get('source','');first,separator,body=text.partition('\n');prefix='# studio-pygas-source: '
 if not first.startswith(prefix) or not separator:raise ValueError('Saved source lacks the canonical source binding; rerender and review required')
 header=json.loads(first[len(prefix):]);binding=header.get('composition',{})
 if binding.get('schema')!='studio.composition/1' or binding.get('graph_sha256')!=hashlib.sha256(encoded(graph)).hexdigest() or binding.get('body_sha256')!=hashlib.sha256(body.encode('utf8')).hexdigest():raise ValueError('Saved graph/source binding differs; rerender and review required')
 if Path(header.get('root','')).resolve()!=Path(source['root']).resolve():raise ValueError('Saved renderer source differs from the registered pyGAS source')
 required=('base/colvar.py','base/bias.py','base/switch.py','base/neighbor.py','tools/graph_workflow.py','tools/cv_bias_gui_server.py')
 files=header.get('files',{});current=receipt['source']['files']
 if not isinstance(files,dict) or any(not current.get(name) or files.get(name)!=current[name] for name in required) or any(name in current and current[name]!=sha for name,sha in files.items()):raise ValueError('Saved graph/source uses a stale library contract; rerender and review required')
 if 'catalog_files' in header and header['catalog_files']!=current:raise ValueError('Saved settings/catalog source changed; rerender and review required')
 inputs=binding.get('inputs',{})
 if not isinstance(inputs,dict) or len(inputs)>32:raise ValueError('Invalid saved composition input bindings')
 for name,sha in inputs.items():
  if not isinstance(name,str) or Path(name).name!=name:raise ValueError('Invalid saved composition input name')
  path=contained(directory/name,[directory])
  if path.is_symlink() or not path.is_file() or path.stat().st_size>512*1024*1024 or digest(path)!=sha:raise ValueError('Selected composition input changed; reimport, rerender and review required')
 return {'status':'passed','scope':'Read-only static consistency check; existing scientific and runtime evidence is not renewed'}


def response(service,data,*,render_report=None):
 project,environment,source,root=context(service,data);directory=location(root,data)
 store=CompositionStore(root,service.store.lock);state=store.read(directory);receipt=catalog(source)
 graph=state.get('graph')
 if graph and graph.get('metadata',{}).get('studio_custom_cvs'):
  from .custom_cv_graph import receipt_for
  receipt=receipt_for(service,receipt,graph,project['id'],data.get('workspace_id'),environment['id'])
 available=assets(service,project,root);derived={'values':{},'provenance':None,'sha256':None}
 if graph and graph.get('settings',{}).get('atoms_path'):
  try:
   path=resolve_input(graph['settings']['atoms_path'],directory,available,root,project);sha=digest(path)
   facts=service.inspect(project['id'],environment['id'],str(path),'structure')
   if digest(path)!=sha:raise ValueError('Structure changed during inspection')
   derived={'values':{key:facts[key] for key in ('n_atoms','numbers')},'provenance':{'path':str(path),'sha256':sha,'frame':0,'source':'ASE read of the authorized serialized structure'},'sha256':sha}
   # pyGAS atomic_types uses atomic numbers, never an engine's zero-based type mapping.
   derived['values']['atomic_types']=list(facts['numbers'])
  except (ValueError,KeyError,OSError) as error:derived['reason']=str(error)
 missing=[];reasons=[]
 if graph:
  try:_,missing=draft_graph(graph,receipt)
  except ValueError as error:reasons.append(str(error))
 if graph and state.get('status')=='rendered' and not missing:
  try:readonly_render_checks(graph,state,receipt,derived,source,directory)
  except (ValueError,KeyError,TypeError,OSError) as error:reasons.append(str(error))
 reasons.extend(state.get('record',{}).get('details',{}).get('reasons',[]))
 if state.get('reason'):reasons.append(state['reason'])
 if render_report:reasons.extend(render_report.get('reasons',[]));missing=render_report.get('missing_fields',missing)
 status=state['status'] if state['status'] in ('rendered','draft','blocked') else 'draft'
 composition={'id':directory.name,'graphPath':str(directory/'workflow.json'),'sourcePath':str(directory/'build_bias.py'),'status':status,'expected':identity(state),'graph_sha256':state['files'].get('workflow.json',{}).get('sha256'),'source_sha256':state['files'].get('build_bias.py',{}).get('sha256'),'missing_fields':missing,'reasons':reasons,'render_blocked':status!='rendered' or bool(missing or reasons)}
 return {'id':directory.name,'kind':'pygas-composition','project_id':project['id'],'workspace_id':data.get('workspace_id'),'composition':composition,'catalog':receipt,'graph':graph,'derived':derived,'assets':available,'missing_fields':missing,'reasons':reasons,'render_blocked':composition['render_blocked'],'validation':'not_run'}


def save(service,data,*,normalize=False):
 project,environment,source,root=context(service,data);directory=location(root,data)
 with service.store.lock:
  pair=CompositionStore(root,service.store.lock);old=pair.read(directory);expected=data.get('expected')
  if expected is None:
   if old['status']!='new':raise ValueError('Existing composition requires current graph/source pair hashes')
   expected=identity(old)
  if expected!=identity(old):raise ValueError('Composition hash conflict; read the current pair')
  receipt=catalog(source)
  incoming=old.get('graph') if normalize else data['graph']
  selected=[]
  if incoming and incoming.get('metadata',{}).get('studio_custom_cvs'):
   from .custom_cv_graph import approved
   from .custom_cv_catalog import extend
   selected=approved(service,incoming,project['id'],data.get('workspace_id'),environment['id']);receipt=extend(receipt,selected)
  if data.get('catalog_files') is not None and data['catalog_files']!=receipt['source']['files']:raise ValueError('Catalog changed; reload the actual source contract')
  incoming=old.get('graph') if normalize else data['graph'];graph,missing=draft_graph(incoming,receipt)
  from .pygas_order import validate_order_change
  validate_order_change(old.get('graph'),graph,receipt)
  source_text=None;reasons=[];bindings=[];result={}
  if receipt.get('settings_schema',{}).get('status')!='passed':reasons.append('Global settings source contract is not matched; current source inspection is required before rendering')
  if not missing and not reasons:
   try:
    graph,bindings=snapshot_assets(graph,receipt,directory,assets(service,project,root),root,project)
    if selected:
     from .custom_cv_graph import module_snapshots
     bindings.extend(module_snapshots(directory,selected))
    result=run_json(environment['executables']['python'],SCIENTIFIC,'render_pygas',{'source_root':source['root'],'graph':graph,'catalog_files':receipt['source']['files'],'structure_path':str(directory/graph['settings']['atoms_path']),'input_sha256':{binding['name']:binding['sha256'] for binding in bindings},'private_custom_cvs':[item['approved_item']for item in selected]},process_env(environment),timeout=90)
    source_text=result['source'];graph=result['graph']
    current=catalog(source)
    if selected:
     from .custom_cv_catalog import extend
     current=extend(current,selected)
    if current['source']['files']!=receipt['source']['files']:raise ValueError('Source changed during graph rendering')
   except (ValueError,RuntimeError,KeyError) as error:reasons.append(str(error))
  saved=pair.save(directory,graph,source_text,expected,repair=data.get('repair') is True,details={'missing_fields':missing,'reasons':reasons})
  for binding in bindings:
   path=directory/binding['name'];service.store.put('artifact',{'id':'composition-'+project['id']+'-'+binding['sha256'][:24],'project_id':project['id'],'name':path.name,'path':str(path),'kind':'input','sha256':binding['sha256'],'size':path.stat().st_size})
  report=response(service,{**data,'path':str(directory/'workflow.json')},render_report={'missing_fields':missing,'reasons':reasons})
  report.update(files=[str(directory/name) for name in ('build_bias.py','workflow.json') if name in saved['files']],input_sha256={name:item['sha256'] for name,item in saved['files'].items()},io_bindings=bindings,plan=result.get('plan'),scope='Source-backed graph/source authoring only; artifact build, numerical and target checks not_run')
  if source_text and data.get('return_source'):report['source']=source_text
  return report


def initialize(service,data):
 """Human create-only empty CV graph; no bias choices, source rendering or build."""
 allowed={'project_id','environment_id','source_id','workspace_id','expected','catalog_files','files'}
 if set(data)-allowed or data.get('source_id')!='pygas':raise ValueError('Initialize only this owned conversation with its empty pair receipt')
 expected=data.get('expected')
 if expected!={'journal_sha256':None,'files':{}}:raise ValueError('An explicit empty graph/source pair receipt is required')
 selected=data.get('files',[])
 if not isinstance(selected,list)or len(selected)>256 or any(not isinstance(v,str)or not v or len(v)>4096 or any(ord(c)<32 for c in v)for v in selected):raise ValueError('Bounded exact current workflow files required')
 project,environment,source,root=context(service,data)
 directory=location(root,{'workspace_id':data.get('workspace_id')})
 with service.store.lock:
  pair=CompositionStore(root,service.store.lock);state=pair.read(directory)
  if state['status']!='new'or identity(state)!=expected or directory.exists():raise ValueError('Composition directory or saved inputs already exist; reload the current graph instead of initializing')
  receipt=catalog(source)
  if data.get('catalog_files')!=receipt['source']['files']:raise ValueError('Catalog changed; reload the actual source contract')
  available=assets(service,project,root)
  candidates={a['path']for a in available if a.get('kind')=='structure'and a['path']in selected}
  if len(candidates)>1:raise ValueError('Select one explicit structure before initializing the graph')
  settings={}
  if candidates:
   path=resolve_input(next(iter(candidates)),directory,available,root,project)
   actual=digest(path);recorded=next(a for a in available if a['path']==str(path))
   if recorded.get('sha256')!=actual:raise ValueError('Selected structure differs from its registered hash; reimport it')
   settings['atoms_path']=path.as_posix()
  graph={'version':2,'parameter_format':'structured-v1','mode':'cvonly','nodes':[],'edges':[],'settings':settings,'metadata':{'studio_initialization':{'origin':'human_empty_cv_graph','scope':'Empty CV-only draft; choose graph mode and actual library nodes explicitly. No bias family or scientific parameters inferred.'}}}
  # Exclusive directory creation claims a previously absent pair. Failed or
  # interrupted initialization remains visible and is never silently retried.
  directory.mkdir(parents=True,exist_ok=False)
  return save(service,{**data,'path':str(directory/'workflow.json'),'graph':graph})
