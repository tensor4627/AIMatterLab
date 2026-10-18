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
 return {'positions':atoms.positions.tolist(),'symbols':atoms.get_chemical_symbols(),'cell':atoms.cell.array.tolist(),'pbc':atoms.pbc.tolist(),'n_atoms':len(atoms),'formula':atoms.get_chemical_formula(),'units':{'positions':'Angstrom','cell':'Angstrom'},'validation':{'status':'passed','scope':'ASE geometry, finite values, cell and overlap checks; no energetic relaxation'}}

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

def render(payload):
 import sys,hashlib
 root=Path(payload['source_root']).resolve();sys.path.insert(0,str(root))
 from tools.cv_bias_gui_server import build_catalog
 from tools.graph_workflow import validate_graph,render_workflow_script
 catalog=build_catalog(root);graph=payload['graph'];plan=validate_graph(graph,catalog);source=render_workflow_script(graph,catalog,root)
 files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'base').glob('*.py'))}
 files.update({p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in ('tools/graph_workflow.py','tools/cv_bias_gui_server.py')})
 source='# studio-pygas-source: '+json.dumps({'root':str(root),'colvar_sha256':files['base/colvar.py'],'files':files})+'\n'+source
 return {'source':source,'graph':graph,'plan':{k:plan[k] for k in ('mode','order','collector_id','cv_size')},'source_root':str(root),'source_sha256':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in ('base/colvar.py','tools/graph_workflow.py','tools/cv_bias_gui_server.py')},'validation':'not_run','scope':'Actual pyGAS graph schema and source rendering; artifact build/reload and target gates still required'}


def suggest(payload):
 from ase.io import read
 from ase.data import atomic_masses,atomic_numbers
 atoms=read(payload['path'],index=0);facts=checked(atoms);intent=payload.get('intent',{})
 supplied={k:{'value':v,'source':'supplied task intent','confidence':'user'} for k,v in intent.items()}
 parameters={**supplied,'n_atoms':{'value':len(atoms),'source':'ASE loaded structure','confidence':'measured'},'pbc':{'value':atoms.pbc.tolist(),'source':'ASE loaded structure','confidence':'measured'},'structure_file':{'value':payload['path'],'source':'authorized asset','confidence':'measured'}}
 defaults={'time_step_fs':{'value':0.25 if 'H' in facts['symbols'] else 1.0,'source':'conservative MD pilot heuristic from presence of hydrogen; verify potential/time-scale','confidence':'proposal'},'pilot_steps':{'value':100,'source':'bounded software trial, not equilibration or convergence','confidence':'technical default'},'walkers':{'value':1,'source':'Studio supported single-walker contract','confidence':'capability'}}
 for k,v in defaults.items():parameters.setdefault(k,v)
 unresolved=[]
 if not intent.get('temperature_K') and intent.get('ambient') is True:parameters['temperature_K']={'value':300,'source':'ambient-temperature request mapped to a reviewable 300 K convention','confidence':'proposal'}
 elif not intent.get('temperature_K'):unresolved.append({'field':'temperature_K','reason':'Thermodynamic target is not determined by structure geometry'})
 if intent.get('enhanced_sampling') and not intent.get('cv_definition'):unresolved.append({'field':'cv_definition','reason':'Choose the physical event/observable and atom groups from the actual pyGAS catalog'})
 return {'parameters':parameters,'unresolved':unresolved,'structure':facts,'scope':'Editable facts/proposals only; no force-field, timestep stability, equilibration or production validation'}
