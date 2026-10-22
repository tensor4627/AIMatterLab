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

def derive(service,run):
 if run['engine']not in ('bias.validate','gpumd.sampling','pydyn.sampling')or run['parameters'].get('mode')=='opes':return None
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
  if not supported_graph(graph):return None
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
  from .pygas_catalog import catalog
  receipt=catalog({'id':'pygas','root':str(root)})
  rebuilt=run_json(producer['environment_snapshot']['executables']['python'],SCIENTIFIC,'render_pygas',{'source_root':str(root),'graph':graph,'catalog_files':receipt['source']['files'],'structure_path':str(original/atoms),'input_sha256':binding.get('inputs',{})},process_env(producer['environment_snapshot']),timeout=90)
  if rebuilt['plan']['cv_size']!=1 or p.get('cv_size')!=1 or rebuilt['source'].partition('\n')[2]!=body:raise ValueError('Producer source differs from current actual canonical renderer; affine proof blocked')
  for asset in producer['snapshots']:
   if digest(contained(original/asset['name'],[original]))!=asset['sha256']:raise ValueError('Producer input changed during source verification')
  for relative,sha in files.items():
   if digest(contained(root/relative,[root]))!=sha:raise ValueError('Execution source changed during canonical source verification')
  if Path(producer['environment_snapshot'].get('repositories',{}).get('pygas','')).resolve()!=root or Path(run['environment_snapshot'].get('repositories',{}).get('pygas','')).resolve()!=root:raise ValueError('Registered source binding changed during verification')
  if digest(produced)!=target_sha or digest(target)!=target_sha:raise ValueError('Serialized artifact changed during source verification')
  if any(digest(contained(directory/name,[directory]))!=sha for name,sha in snapshots.items()):raise ValueError('Validation input changed during cell convention verification')
  return {'schema':'studio.cell-derivative/1','convention':'fixed_fractional_positions','run_id':run['id'],'producer_id':producer['id'],'artifact_sha256':target_sha,'structure_sha256':structure_sha,'run_snapshot_sha256':snapshots,'producer_graph_sha256':binding['graph_sha256'],'producer_body_sha256':binding['body_sha256'],'source_files':files,'declared_cv_atoms':declared,'producer_output_observation':'Current successful producer output observed and hashed now; not a historical completion-time output attestation','scope':'Only source-matched single CoordNum/LessThanCubic/mean/MetaD-family graph. Force FD holds Cartesian positions; cell FD co-deforms positions at fixed fractions. No unknown/mixed-CV, remote or physical suitability inference.'}
 return None
