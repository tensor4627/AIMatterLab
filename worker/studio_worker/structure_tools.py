"""ASE authoring tools. Bounded, declarative recipes; no arbitrary Python."""
import json
import math
from pathlib import Path

MAX_ATOMS=20000

def checked(atoms):
 import numpy as np
 if not 0<len(atoms)<=MAX_ATOMS:raise ValueError('Structure requires 1..20,000 atoms')
 if not np.isfinite(atoms.positions).all() or not np.isfinite(atoms.cell.array).all():raise ValueError('Nonfinite structure')
 if any(atoms.pbc) and abs(np.linalg.det(atoms.cell.array))<1e-9:raise ValueError('Periodic structure requires a nonsingular cell')
 from ase.neighborlist import neighbor_list
 # A tiny cutoff detects overlapping distinct atoms without quadratic memory.
 i,j,d=neighbor_list('ijd',atoms,0.1,self_interaction=False)
 if any((i!=j)&(d<0.1)):raise ValueError('Overlapping atoms below 0.1 Angstrom')
 return {'positions':atoms.positions.tolist(),'symbols':atoms.get_chemical_symbols(),'numbers':atoms.numbers.tolist(),'cell':atoms.cell.array.tolist(),'pbc':atoms.pbc.tolist(),'n_atoms':len(atoms),'formula':atoms.get_chemical_formula(),'units':{'positions':'Angstrom','cell':'Angstrom'},'validation':{'status':'passed','scope':'ASE geometry, finite values, cell and overlap checks; no energetic relaxation'}}

def create(payload):
 from ase import Atoms
 from ase.build import bulk,molecule,surface
 from ase.io import read,write
 from ase.data import reference_states,atomic_numbers
 recipe=payload['recipe'];kind=recipe.get('kind');assumptions=[]
 if kind=='bulk':
  allowed=('name','crystalstructure','a','b','c','alpha','covera','u','orthorhombic','cubic')
  kwargs={k:recipe[k] for k in allowed if k in recipe}
  atoms=bulk(**kwargs)
  if 'a' not in recipe or 'crystalstructure' not in recipe:assumptions.append({'field':'bulk lattice/crystal','value':atoms.cell.array.tolist(),'source':'ASE reference_states for element','confidence':'reference default; inspect before simulation'})
 elif kind=='molecule':
  atoms=molecule(recipe['name']);vacuum=float(recipe.get('vacuum',6));
  if not 0<vacuum<=100:raise ValueError('Vacuum must be >0 and <=100 Angstrom')
  atoms.center(vacuum=vacuum);assumptions.append({'field':'vacuum','value':vacuum,'source':'user' if 'vacuum' in recipe else 'isolated molecule preview default','confidence':'technical default'})
 elif kind=='import':atoms=read(payload['input_path'],index=0)
 elif kind=='explicit':atoms=Atoms(symbols=recipe['symbols'],positions=recipe['positions'],cell=recipe.get('cell'),pbc=recipe.get('pbc',False))
 elif kind=='surface':
  lattice=bulk(**recipe['bulk']);indices=recipe['indices'];layers=recipe['layers'];vacuum=float(recipe.get('vacuum',10))
  if len(indices)!=3 or any(type(v)is not int for v in indices) or type(layers)is not int or not 1<=layers<=100 or not 0<vacuum<=100:raise ValueError('Explicit Miller indices, bounded layers and vacuum required')
  atoms=surface(lattice,indices,layers,vacuum=vacuum,periodic=False)
 else:raise ValueError('Choose bulk, molecule, surface, import or explicit recipe')
 repeat=recipe.get('repeat',[1,1,1])
 if not isinstance(repeat,list) or len(repeat)!=3 or any(type(v)is not int or not 1<=v<=100 for v in repeat) or len(atoms)*math.prod(repeat)>MAX_ATOMS:raise ValueError('Repeat exceeds structure limit')
 atoms=atoms.repeat(repeat)
 report=checked(atoms);output=Path(payload['output_path']);write(output,atoms,format='extxyz')
 reloaded=read(output);checked(reloaded)
 import ase,hashlib
 return {**report,'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'size':output.stat().st_size,'provenance':{'library':'ASE','version':ase.__version__,'recipe':recipe,'assumptions':assumptions},'suggested_parameters':{'n_atoms':{'value':len(atoms),'source':'serialized ASE structure'},'pbc':{'value':atoms.pbc.tolist(),'source':'serialized ASE structure'},'structure_file':{'value':str(output),'source':'created asset'}},'unresolved_science':['target temperature and ensemble when not supplied','potential compatibility and intended CV/atom selection']}

def portable_graph(graph):
 """Change only Studio I/O locations; CV/bias science and backend stay exact."""
 import copy
 result=copy.deepcopy(graph);settings=result.setdefault('settings',{});bindings={}
 for key in ('atoms_path','pt_path'):
  value=settings.get(key)
  if not isinstance(value,str) or not value.strip():raise ValueError('Workflow settings need '+key)
  name=value.replace('\\','/').split('/')[-1]
  if not name or name in ('.','..','build_bias.py','workflow.json') or any(ch in name for ch in ('\0','\r','\n')):raise ValueError('Invalid snapshot I/O filename')
  bindings[key]={'source':value,'name':name};settings[key]=name
 if settings['atoms_path']==settings['pt_path']:raise ValueError('Bias output cannot overwrite its structure input')
 settings['workflow_path']='workflow.json'
 return result,bindings


def graph_snapshot_io(graph):
 """Mirror the inspected pyGAS v1/v2 renderer output naming without importing it."""
 settings=graph['settings'];target=settings['pt_path']
 if int(graph.get('version',1))<=1:outputs=[target];manifests=[]
 else:
  formats=settings.get('artifact_formats',['torchscript','aoti'])
  if isinstance(formats,str):formats=[formats]
  if not formats or any(x not in ('torchscript','aoti') for x in formats):raise ValueError('Unknown pyGAS artifact formats')
  stem=str(Path(target).with_suffix(''))
  if Path(stem).suffix in ('.pt','.pt2'):stem=str(Path(stem).with_suffix(''))
  outputs=[stem+{'torchscript':'.pt','aoti':'.pt2'}[kind] for kind in dict.fromkeys(formats)]
  manifests=[stem+'.manifest.json']
 return {'inputs':[settings['atoms_path']],'outputs':outputs,'manifests':manifests,'workflow':settings['workflow_path'],'portable':True}


def render(payload):
 """Render only the registered graph compiler with allowlisted data values."""
 import sys,hashlib
 if __package__:
  from .pygas_catalog import catalog as source_catalog,_read
  from .pygas_values import compiler_graph
  from .pygas_dimensions import validate_dimensions
  from .pygas_settings import validate_settings
  from .composition_store import encoded
 else:
  from pygas_catalog import catalog as source_catalog,_read
  from pygas_values import compiler_graph
  from pygas_dimensions import validate_dimensions
  from pygas_settings import validate_settings
  from composition_store import encoded
 root=Path(payload['source_root']).resolve()
 if any(ord(c)<32 or c in '\\"' for c in str(root)):raise ValueError('Registered source path cannot be represented safely by the actual renderer')
 receipt=source_catalog({'id':'pygas','root':str(root)})
 if receipt.get('settings_schema',{}).get('status')!='passed':raise ValueError('Global settings source contract differs from the reviewed adapter; save a blocked draft and inspect the current source before rendering')
 if payload.get('catalog_files') is not None and payload['catalog_files']!=receipt['source']['files']:raise ValueError('Catalog/source changed before rendering')
 sys.path.insert(0,str(root))
 from tools.cv_bias_gui_server import build_catalog
 from tools.graph_workflow import validate_graph,render_workflow_script
 catalog=build_catalog(root);graph,bindings=portable_graph(payload['graph'])
 validate_settings(graph.get('settings',{}),receipt.get('settings_schema',{}))
 compiled=compiler_graph(graph,receipt['catalog']);plan=validate_graph(compiled,catalog)
 structure=None
 if payload.get('structure_path'):
  from ase.io import read
  atoms=read(payload['structure_path'],index=0);structure={'n_atoms':len(atoms),'numbers':atoms.numbers.tolist()}
 dimension_report=validate_dimensions(compiled,receipt,plan,structure)
 body=render_workflow_script(compiled,catalog,root)
 files={str(p.relative_to(root)):_read(root,str(p.relative_to(root)))[1] for p in sorted((root/'base').glob('*.py'))}
 files.update({p:_read(root,p)[1] for p in ('tools/graph_workflow.py','tools/cv_bias_gui_server.py')})
 if source_catalog({'id':'pygas','root':str(root)})['source']['files']!=receipt['source']['files']:raise ValueError('Source changed during rendering')
 composition={'schema':'studio.composition/1','graph_sha256':hashlib.sha256(encoded(graph)).hexdigest(),'body_sha256':hashlib.sha256(body.encode('utf8')).hexdigest(),'inputs':payload.get('input_sha256',{})}
 source='# studio-pygas-source: '+json.dumps({'root':str(root),'colvar_sha256':files['base/colvar.py'],'files':files,'catalog_files':receipt['source']['files'],'io':graph_snapshot_io(graph),'composition':composition})+'\n'+body
 return {'source':source,'graph':graph,'io_bindings':bindings,'io_scope':'Scientific inputs and outputs use immutable run basenames; original source paths are authoring provenance only','plan':{k:plan[k] for k in ('mode','order','collector_id','cv_size')},'source_root':str(root),'source_sha256':receipt['source']['files'],'dimensions':dimension_report,'validation':'not_run','scope':'Actual pyGAS graph schema and source rendering; artifact build/reload and target gates still required'}


def molecular_topology(atoms):
 """Geometry-derived candidates, never atom IDs guessed from a molecule name."""
 if len(atoms)>512:return {'status':'not_run','reason':'Topology preview is bounded to 512 atoms'}
 from ase.neighborlist import neighbor_list,natural_cutoffs
 symbols=atoms.get_chemical_symbols();i,j=neighbor_list('ij',atoms,natural_cutoffs(atoms,mult=1.15),self_interaction=False)
 adjacent=[set() for _ in atoms]
 for a,b in zip(i,j):
  if a!=b:adjacent[int(a)].add(int(b))
 carbonyl=lambda c:symbols[c]=='C' and any(symbols[o]=='O' for o in adjacent[c])
 candidates=[]
 for n in range(len(atoms)):
  if symbols[n]!='N':continue
  previous=[c for c in adjacent[n] if carbonyl(c)]
  for alpha in sorted(adjacent[n]):
   if symbols[alpha]!='C' or carbonyl(alpha):continue
   following=[c for c in adjacent[alpha] if carbonyl(c)]
   if len(previous)!=1 or len(following)!=1:continue
   c=following[0];next_n=[x for x in adjacent[c] if symbols[x]=='N' and x!=n]
   if len(next_n)!=1:continue
   phi=[previous[0],n,alpha,c];psi=[n,alpha,c,next_n[0]]
   if len(set(phi))!=4 or len(set(psi))!=4:continue
   record={'alpha_atom_zero_based':alpha,'phi':phi,'psi':psi,'phi_one_based':[v+1 for v in phi],'psi_one_based':[v+1 for v in psi],'source':'ASE covalent-radius neighbor graph: carbonyl C - N - alpha C - carbonyl C - N','confidence':'geometry-derived candidate; check unusual bonding/charged states'}
   for name,indices in [('phi',phi),('psi',psi)]:
    try:
     angle=atoms.get_dihedral(*indices,mic=bool(any(atoms.pbc)));record[name+'_reference_rad']=(math.radians(angle)+math.pi)%(2*math.pi)-math.pi
    except (ValueError,ZeroDivisionError):record[name+'_reference_status']='blocked: degenerate geometry'
   record['reference_convention']='ASE dihedral in [-pi,pi); verify sign and atom order against selected pyGAS PeriodicTorsion'
   candidates.append(record)
 return {'status':'passed','bond_pairs_zero_based':[[a,b] for a,ns in enumerate(adjacent) for b in sorted(ns) if a<b],'peptide_torsion_candidates':candidates,'scope':'Geometry interpretation only, not chemical validation or automatic scientific intent'}

def suggest(payload):
 from ase.io import read
 from ase.data import atomic_masses,atomic_numbers
 atoms=read(payload['path'],index=0);facts=checked(atoms);intent=payload.get('intent',{})
 supplied={k:{'value':v,'source':'supplied task intent','confidence':'user'} for k,v in intent.items()}
 parameters={**supplied,'n_atoms':{'value':len(atoms),'source':'ASE loaded structure','confidence':'measured'},'pbc':{'value':atoms.pbc.tolist(),'source':'ASE loaded structure','confidence':'measured'},'structure_file':{'value':payload['path'],'source':'authorized asset','confidence':'measured'}}
 topology=molecular_topology(atoms)
 defaults={'time_step_fs':{'value':0.25 if 'H' in facts['symbols'] else 1.0,'source':('conservative H-containing pilot heuristic' if 'H' in facts['symbols'] else 'conservative non-H pilot heuristic')+'; verify potential/time-scale','confidence':'proposal'},'pilot_steps':{'value':100,'source':'bounded software trial, not equilibration or convergence','confidence':'technical default'},'walkers':{'value':1,'source':'Studio supported single-walker contract','confidence':'capability'}}
 for k,v in defaults.items():parameters.setdefault(k,v)
 unresolved=[]
 if intent.get('temperature_K') is None and intent.get('temperature') is not None:parameters['temperature_K']={'value':intent['temperature'],'source':'supplied temperature alias','confidence':'user'}
 if intent.get('enhanced_sampling'):
  for key,value,source in [('cv_internal_dtype',None,'pyGAS no internal downcast; preserve float64 authoring inputs'),('artifact_format','torchscript','Studio portable .pt authoring default'),('dtype','float64','GPU-Sampling Bias/CV input contract')]:parameters.setdefault(key,{'value':value,'source':source,'confidence':'technical default'})
  count=intent.get('n_steps',intent.get('steps',parameters['pilot_steps']['value']));pace=intent.get('pace')
  if type(count) is int and count>0 and type(pace) is int and pace>0:parameters.setdefault('history_capacity',{'value':1+math.ceil(count/pace),'source':'one initial slot + ceil(n_steps / deposition pace); single walker','confidence':'derived capacity, not convergence'})
 if not parameters.get('temperature_K') and intent.get('ambient') is True:parameters['temperature_K']={'value':300,'source':'ambient-temperature request mapped to a reviewable 300 K convention','confidence':'proposal'}
 elif not parameters.get('temperature_K'):unresolved.append({'field':'temperature_K','reason':'Thermodynamic target is not determined by structure geometry'})
 if intent.get('enhanced_sampling') and not intent.get('cv_definition'):unresolved.append({'field':'cv_definition','reason':'Choose the physical event/observable and atom groups from the actual pyGAS catalog'})
 return {'parameters':parameters,'unresolved':unresolved,'structure':facts,'topology':topology,'scope':'Editable facts/proposals only; no force-field, timestep stability, equilibration or production validation'}
