"""Approved private primitives use the existing pyGAS graph compiler unchanged.
All bindings are resolved from the worker-owned private registry, never a graph flag.
"""
import copy,hashlib,json,os,re,secrets
from pathlib import Path
from studio_worker.tools.custom_cv_catalog import checked_entry,extend,check_graph_values
from studio_worker.tools.custom_cv_numerics import bounded_bytes


def controller(service):
 with service.store.lock:
  value=getattr(service,'custom_cvs',None)
  if value is None:
   from studio_worker.workspace.custom_cv_service import CustomCvService
   value=service.custom_cvs=CustomCvService(service)
  return value


def approved(service,graph,project_id,workspace_id,environment_id):
 bindings=graph.get('metadata',{}).get('studio_custom_cvs',[])
 if not isinstance(bindings,list)or len(bindings)>8:raise ValueError('At most eight explicitly attached private primitives are supported')
 selected=[];seen=set()
 for binding in bindings:
  if not isinstance(binding,dict)or not isinstance(binding.get('id'),str)or binding['id']in seen:raise ValueError('Invalid or duplicate private CV attachment identity')
  seen.add(binding['id']);item=controller(service).library.read(binding['id'])
  if item['workspace_id']!=workspace_id or item['project_id']!=project_id:raise PermissionError('Explicitly reuse a private definition into this owned conversation before attaching it')
  checked=checked_entry(item)
  record=next((row for row in service.store.list('private-cv-lineage')if row['entry_id']==item['id']and row['workspace_id']==workspace_id and row['project_id']==project_id),None)
  exact=record.get('attachment_binding')if record else None
  if binding!=exact or {k:v for k,v in binding.items()if k!='revision'}!={k:v for k,v in checked['binding'].items()if k!='revision'}:raise ValueError('Private CV attachment revision changed; review and reattach the exact owned revision')
  checked['binding']=copy.deepcopy(binding)
  # Primitive readiness is valid only on the actual selected structure/runtime.
  from studio_worker.compute.runtime_guides import RuntimeGuides
  if environment_id!=item['numerical'].get('environment_id'):raise ValueError('The selected authoring environment changed; check the primitive in that registered environment first')
  environment=service.store.get('environment',environment_id)
  guide=RuntimeGuides(service.root/'runtime-guides').read(environment,'pygas.build')
  if guide.get('status')!='observed'or guide.get('receipt')!=item['numerical'].get('runtime_receipt_sha256'):raise ValueError('Private primitive runtime changed; repeat its exact CPU check')
  from studio_worker.workspace.pygas_composition import assets,resolve_input
  project=service.store.get('project',project_id);root=service.root/'projects'/project_id/'inputs';directory=root/('cv-'+workspace_id)
  structure=resolve_input(graph.get('settings',{}).get('atoms_path'),directory,assets(service,project,root),root,project)
  if hashlib.sha256(bounded_bytes(structure,4*1024*1024)).hexdigest()!=item['numerical'].get('structure_sha256'):raise ValueError('Selected private CV structure changed; repeat reference/numerical checks before rendering')
  selected.append({**checked,'approved_item':{**item,'revision':binding['revision']}})
 check_graph_values(graph,selected)
 return selected


def receipt_for(service,receipt,graph,project_id,workspace_id,environment_id):
 selected=approved(service,graph,project_id,workspace_id,environment_id)
 return extend(receipt,selected)if selected else receipt


def module_snapshots(directory,selected):
 directory=Path(directory).absolute()
 if directory.resolve()!=directory or directory.is_symlink():raise ValueError('Linked composition directory refused')
 directory.mkdir(parents=True,exist_ok=True);bindings=[]
 for entry in selected:
  binding=entry['binding'];name=binding['module_file'];data=entry['source'].encode('utf8')
  if not re.fullmatch(r'studio_custom_[0-9a-f]{64}\.py',name)or hashlib.sha256(data).hexdigest()!=binding['code_sha256']:raise ValueError('Private module identity differs')
  target=directory/name
  if target.exists():
   if bounded_bytes(target,65536)!=data:raise ValueError('Existing private module snapshot changed; explicit repair is required')
  else:
   temporary=directory/('.studio-custom-'+secrets.token_hex(8))
   try:
    with temporary.open('xb')as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,target)
   finally:
    if temporary.exists():temporary.unlink()
  bindings.append({'name':name,'sha256':binding['code_sha256'],'source':'human_approved_private_formula'})
 return bindings


def attach(service,data):
 from studio_worker.workspace.pygas_composition import identity,save
 value=controller(service)
 with value.lock,service.store.lock:
  ctx=value.context(data);item=value.owned(data,ctx);value.library._cas(item['id'],data['expected'])
  selected=checked_entry(item);report=item['numerical']
  if not ctx['structure']or report.get('structure_sha256')!=ctx['structure']['sha256']or report.get('runtime_receipt_sha256')!=ctx['runtime'].get('receipt')or report.get('environment_id')!=ctx['environment']['id']or ctx['runtime']['status']!='observed':raise ValueError('Current structure or selected runtime changed; repeat the exact bounded primitive check before attaching')
  state=ctx['pair']
  if data.get('composition_expected')!=identity(state):raise ValueError('Composition changed before attachment; reload the exact current graph/source pair')
  graph=copy.deepcopy(state.get('graph'))
  if not graph:raise ValueError('Save the current graph before attaching a custom primitive')
  metadata=graph.setdefault('metadata',{});old=metadata.setdefault('studio_custom_cvs',[])
  existing=next((b for b in old if b['id']==item['id']),None)
  if any(n.get('class_name')==selected['entry']['name']and n.get('id')!='custom_'+item['id']for n in graph['nodes']):raise ValueError('This deterministic primitive class is already used; explicit graph editing is required')
  metadata['studio_custom_cvs']=[selected['binding']if b['id']==item['id']else b for b in old]if existing else[*old,selected['binding']]
  # No silent scientific wiring or replacement. A new node is shown with its exact
  # constructor values; the human/explicitly permitted Agent chooses its graph edges.
  node={'id':'custom_'+item['id'],'kind':'cv','class_name':selected['entry']['name'],'params':selected['parameter_values']}
  if existing:
   if not any(n['id']==node['id']for n in graph['nodes']):raise ValueError('Attached private node identity changed; explicit graph repair required')
   graph['nodes']=[node if n['id']==node['id']else n for n in graph['nodes']]
  else:graph['nodes'].append(node)
  service.store.put('private-cv-lineage',{'id':item['id']+'-'+hashlib.sha256(ctx['workspace'].encode()).hexdigest()[:16],'entry_id':item['id'],'workspace_id':ctx['workspace'],'project_id':ctx['project']['id'],'bindings':{k:item[k]for k in('spec_sha256','code_sha256','parameters_sha256')},'attachment_binding':selected['binding'],'paths':[str(ctx['directory']/name)for name in('workflow.json','build_bias.py',selected['binding']['module_file'])],'scope':'Protect this project and its consuming run lineage before any private source is copied, including an interrupted attachment'})
  composition=save(service,{'project_id':ctx['project']['id'],'environment_id':ctx['environment']['id'],'source_id':'pygas','workspace_id':ctx['workspace'],'path':str(ctx['directory']/'workflow.json'),'expected':data['composition_expected'],'graph':graph})
  return {**value.read(data),'composition_result':composition,'attachment':{'workspace_id':ctx['workspace'],'entry_id':item['id'],'graph_sha256':composition['composition']['graph_sha256'],'scope':'Private primitive node attached as an unwired draft; explicit graph connections, whole bias build and real consuming target validation are still required'}}
