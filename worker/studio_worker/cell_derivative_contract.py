"""Worker-derived, narrowly source-proven cell finite-difference convention.
Never selected from user parameters, history, class names or a best-fit error.
"""
import hashlib,json
from pathlib import Path
from .composition_store import encoded
from .util import contained,digest,run_json
from .adapters import SCIENTIFIC,process_env
from .derivative_selection import cv_atoms

NEIGHBOR_SHA='58e2a18477af49c8fe52333e4a7f59b7dbdcf15e9ea75b7339e68a2c06630ec3'

def supported_graph(graph):
 if graph.get('mode')!='metad':return False
 nodes=graph.get('nodes',[]);kinds=('input','neighbor','switch','cv','reduce','collect','output','bias')
 if len(nodes)!=len(kinds) or any(sum(n.get('kind')==kind for n in nodes)!=1 for kind in kinds):return False
 by={n['kind']:n for n in nodes};ids={k:n['id'] for k,n in by.items()}
 if len(set(ids.values()))!=len(kinds):return False
 if by['neighbor'].get('class_name') not in ('PCVectorLB','PCVectorTypesFilter') or by['cv'].get('class_name')!='CoordNum' or by['switch'].get('class_name')!='LessThanCubic' or by['reduce'].get('params')!={'operation':'mean'} or by['bias'].get('class_name')not in ('MetaDGaussianBias','WTMetaDGaussianBias','FFWTPDMetaDGaussianBias'):return False
 if any(n.get('output_size') is not None for n in nodes):return False
 expected=[('input','pos','neighbor','pos'),('input','cell','neighbor','cell'),('input','side_array','neighbor','side_array'),('neighbor','pcvector','cv','pcvector'),('neighbor','side_array','cv','side_array'),('switch','switch','cv','switch_func'),('cv','value','reduce','value'),('reduce','value','collect','value'),('collect','cv','output','cv'),('collect','cv','bias','cv'),('input','cv_traj','bias','cv_traj'),('input','bias_traj','bias','bias_traj'),('bias','bias','output','bias')]
 desired={(ids[a],b,ids[c],d)for a,b,c,d in expected}
 try:actual=[(e['source']['node'],e['source']['port'],e['target']['node'],e['target']['port'])for e in graph.get('edges',[])]
 except (KeyError,TypeError):return False
 return len(actual)==len(desired) and set(actual)==desired


def supported_private_graph(graph):
 """Closed current compiler route; names alone never authorize this branch."""
 if graph.get('mode')!='metad':return False
 bindings=graph.get('metadata',{}).get('studio_custom_cvs',[])
 if not isinstance(bindings,list)or len(bindings)!=1 or not isinstance(bindings[0],dict)or not isinstance(bindings[0].get('id'),str)or bindings[0].get('output_size')!=1:return False
 nodes=graph.get('nodes',[]);has_identity=any(node.get('kind')=='reduce'for node in nodes);kinds=('input','neighbor','cv','collect','output','bias')+(('reduce',)if has_identity else())
 if len(nodes)!=len(kinds)or any(sum(n.get('kind')==kind for n in nodes)!=1 for kind in kinds):return False
 by={n['kind']:n for n in nodes};ids={kind:node['id']for kind,node in by.items()}
 if len(set(ids.values()))!=len(kinds):return False
 if by['neighbor'].get('class_name')not in('PCVectorLB','PCVectorTypesFilter')or by['cv'].get('class_name')!=bindings[0].get('class_name')or by['cv']['id']!='custom_'+bindings[0].get('id','')or by['bias'].get('class_name')not in('MetaDGaussianBias','WTMetaDGaussianBias','FFWTPDMetaDGaussianBias','FlexibleWallBias'):return False
 if any(n.get('output_size')is not None for n in nodes):return False
 # Only the compiler's explicit scalar identity reshape preserves this one-component contract.
 if has_identity and by['reduce'].get('params')!={'operation':'identity'}:return False
 expected=[('input','pos','neighbor','pos'),('input','cell','neighbor','cell'),('input','side_array','neighbor','side_array'),('input','pos','cv','pos'),('input','cell','cv','cell'),('input','side_array','cv','side_array'),('cv','value','collect','value'),('collect','cv','output','cv'),('collect','cv','bias','cv'),('input','cv_traj','bias','cv_traj'),('bias','bias','output','bias')]
 if has_identity:
  expected.remove(('cv','value','collect','value'));expected.extend([('cv','value','reduce','value'),('reduce','value','collect','value')])
 if by['bias']['class_name']!='FlexibleWallBias':expected.append(('input','bias_traj','bias','bias_traj'))
 desired={(ids[a],b,ids[c],d)for a,b,c,d in expected}
 try:actual=[(e['source']['node'],e['source']['port'],e['target']['node'],e['target']['port'])for e in graph.get('edges',[])]
 except(KeyError,TypeError):return False
 return len(actual)==len(desired)and set(actual)==desired


def private_producer(service,graph,producer):
 if not supported_private_graph(graph):return None
 from .custom_cv_graph import controller,approved
 binding=graph['metadata']['studio_custom_cvs'][0]
 item=controller(service).library.read(binding['id'])
 selected=approved(service,graph,item['project_id'],item['workspace_id'],producer['environment_id'])
 if len(selected)!=1 or selected[0]['binding']!=binding:raise ValueError('Private producer differs from its approved source/reference binding')
 original=Path(producer['directory'])/'simulation'
 for entry in selected:
  if digest(contained(original/entry['binding']['module_file'],[original]))!=entry['binding']['code_sha256']:raise ValueError('Private producer implementation snapshot changed')
 return selected


def derive(service,run):
 if run['engine']not in ('bias.validate','gpumd.sampling','pydyn.sampling'):return None
 private_required=bool(run.get('private_cv_entries'))or any(row['project_id']==run.get('project_id')for row in service.store.list('private-cv-lineage'))if service else False
 if run['parameters'].get('mode')=='opes':
  if private_required:raise ValueError('Private custom CV OPES target validation is unsupported; an explicit reviewed producer contract is required')
  return None
 result=_derive(service,run)
 if private_required and not result:raise ValueError('Private custom bias target convention is unsupported or has no current exact producer proof; legacy derivative fallback is forbidden')
 return result


def _derive(service,run):
 p=run['parameters'];directory=Path(run['directory'])/'results';target=contained(directory/p['bias_file'],[directory])
 if target.suffix!='.pt':return None
 target_sha=digest(target);structure_sha=digest(contained(directory/p['structure_file'],[directory]));snapshots={a['name']:a['sha256']for a in run['snapshots']}
 for producer in service.store.runs():
  if producer['engine']!='pygas.build' or producer['project_id']!=run['project_id']or producer['status']!='succeeded'or producer.get('exit',{}).get('exit_code')!=0:continue
  output=producer.get('parameters',{}).get('output_file','');produced=Path(producer['directory'])/'results'/output
  if not output or Path(output).name!=output or not produced.is_file() or produced.is_symlink()or digest(produced)!=target_sha:continue
  original=Path(producer['directory'])/'simulation';graph_path=original/'workflow.json';source_path=original/'build_bias.py'
  if not graph_path.is_file()or not source_path.is_file():return None
  for asset in producer['snapshots']:
   if digest(contained(original/asset['name'],[original]))!=asset['sha256']:raise ValueError('Producer immutable input changed; cell convention proof blocked')
  graph=json.loads(graph_path.read_text(encoding='utf8'))
  private=None
  if not supported_graph(graph):
   private=private_producer(service,graph,producer)
   if not private:
    if graph.get('metadata',{}).get('studio_custom_cvs'):raise ValueError('Unsupported private custom graph target convention; legacy fallback is forbidden')
    return None
  source=source_path.read_text(encoding='utf8');first,_,body=source.partition('\n');prefix='# studio-pygas-source: '
  if not first.startswith(prefix):return None
  header=json.loads(first[len(prefix):]);binding=header.get('composition',{})
  if binding.get('graph_sha256')!=hashlib.sha256(encoded(graph)).hexdigest()or binding.get('body_sha256')!=hashlib.sha256(body.encode('utf8')).hexdigest():raise ValueError('Producer canonical graph/body binding differs; cell convention proof blocked')
  root=Path(producer['environment_snapshot'].get('repositories',{}).get('pygas','')).resolve()
  if root!=Path(header.get('root','')).resolve()or root!=Path(run['environment_snapshot'].get('repositories',{}).get('pygas','')).resolve():return None
  files=header.get('files',{})
  if files.get('base/neighbor.py')!=NEIGHBOR_SHA:return None
  for relative,sha in files.items():
   path=contained(root/relative,[root])
   if not path.is_file()or digest(path)!=sha:raise ValueError('Producer execution source changed; targeted source review required')
  mandatory=('base/colvar.py','base/bias.py','base/neighbor.py','base/switch.py','base/combine.py','base/linalg.py','base/artifact.py','tools/graph_workflow.py','tools/cv_bias_gui_server.py')
  if any(name not in files for name in mandatory):raise ValueError('Historical execution source identity not_recorded; affine proof blocked')
  atoms=graph['settings']['atoms_path']
  if Path(atoms).name!=atoms or binding.get('inputs',{}).get(atoms)!=structure_sha or digest(original/atoms)!=structure_sha:return None
  declared=cv_atoms(producer.get('parameters',{}))
  if not isinstance(declared,list)or declared!=cv_atoms(p):return None
  private_group=None
  if private:
   from .custom_formula import referenced_atoms
   structure=run_json(producer['environment_snapshot']['executables']['python'],SCIENTIFIC,'structure',{'path':str(original/atoms),'frame':0},process_env(producer['environment_snapshot']),timeout=20)
   count=structure['n_atoms'];item=private[0]['approved_item'];allowed=item['spec']['atom_selection'];referenced=referenced_atoms(item['spec'],item['parameter_values'],count)
   if declared!=allowed:raise ValueError('Private producer/consumer CV atom group differs from its exact human-approved formula group')
   private_group={'kind':'approved_private_formula_group','atom_selection':allowed,'referenced_atoms':referenced,'structure_atoms':count,**{key:item[key]for key in('spec_sha256','code_sha256','parameters_sha256')}}
  from .pygas_catalog import catalog
  receipt=catalog({'id':'pygas','root':str(root)})
  if private:
   from .custom_cv_catalog import extend
   receipt=extend(receipt,private)
   if header.get('catalog_files')!=receipt['source']['files']:raise ValueError('Private producer catalog/source bindings changed')
   if any(binding.get('inputs',{}).get(entry['binding']['module_file'])!=entry['binding']['code_sha256']for entry in private):raise ValueError('Private producer source does not bind its exact module snapshot')
  rebuilt=run_json(producer['environment_snapshot']['executables']['python'],SCIENTIFIC,'render_pygas',{'source_root':str(root),'graph':graph,'catalog_files':receipt['source']['files'],'structure_path':str(original/atoms),'input_sha256':binding.get('inputs',{}),'private_custom_cvs':[entry['approved_item']for entry in(private or[])]},process_env(producer['environment_snapshot']),timeout=90)
  if rebuilt['plan']['cv_size']!=1 or p.get('cv_size')!=1 or rebuilt['source'].partition('\n')[2]!=body:raise ValueError('Producer source differs from current actual canonical renderer; affine proof blocked')
  for asset in producer['snapshots']:
   if digest(contained(original/asset['name'],[original]))!=asset['sha256']:raise ValueError('Producer input changed during source verification')
  for relative,sha in files.items():
   if digest(contained(root/relative,[root]))!=sha:raise ValueError('Execution source changed during canonical source verification')
  if Path(producer['environment_snapshot'].get('repositories',{}).get('pygas','')).resolve()!=root or Path(run['environment_snapshot'].get('repositories',{}).get('pygas','')).resolve()!=root:raise ValueError('Registered source binding changed during verification')
  if digest(produced)!=target_sha or digest(target)!=target_sha:raise ValueError('Serialized artifact changed during source verification')
  if any(digest(contained(directory/name,[directory]))!=sha for name,sha in snapshots.items()):raise ValueError('Validation input changed during cell convention verification')
  return {'schema':'studio.cell-derivative/1','convention':'fixed_fractional_positions','run_id':run['id'],'producer_id':producer['id'],'artifact_sha256':target_sha,'structure_sha256':structure_sha,'run_snapshot_sha256':snapshots,'producer_graph_sha256':binding['graph_sha256'],'producer_body_sha256':binding['body_sha256'],'source_files':files,'private_cv_bindings':[entry['binding']for entry in(private or[])],**({'private_cv_atom_contract':private_group}if private_group else{}),'declared_cv_atoms':declared,'producer_output_observation':'Current successful producer output observed and hashed now; not a historical completion-time output attestation','scope':('Source-matched single human-approved deterministic private primitive with current reference/runtime/structure, exact module snapshot and regenerated pyGAS bias body.'if private else'Only source-matched single CoordNum/LessThanCubic/mean/MetaD-family graph.')+' Force FD holds Cartesian positions; cell FD co-deforms positions at fixed fractions. No unknown/mixed-CV, remote or physical suitability inference.'}
 return None
