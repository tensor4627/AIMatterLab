"""Independent reference adapter candidate for an exact selected-pair formula.
This validates the formula on a recorded geometry, not physical suitability.
"""
import ast,hashlib
from pathlib import Path


def pair_formula(spec,values):
 tree=ast.parse(spec['expression'],mode='eval').body
 if not isinstance(tree,ast.Call)or not isinstance(tree.func,ast.Name)or tree.func.id!='norm'or len(tree.args)!=1:return None
 vector=tree.args[0];periodic=False
 if isinstance(vector,ast.Call)and isinstance(vector.func,ast.Name)and vector.func.id=='mic'and len(vector.args)==2 and isinstance(vector.args[1],ast.Name)and vector.args[1].id=='cell':
  vector=vector.args[0];periodic=True
 if not isinstance(vector,ast.BinOp)or not isinstance(vector.op,ast.Sub):return None
 def index(node):
  if not isinstance(node,ast.Subscript)or not isinstance(node.value,ast.Name)or node.value.id!='pos':return None
  value=node.slice.value if isinstance(node.slice,ast.Constant)else values.get(node.slice.id)if isinstance(node.slice,ast.Name)else None
  return value if type(value)is int and value>=0 else None
 j,i=index(vector.left),index(vector.right)
 if i is None or j is None or i==j:return None
 if periodic!=(spec['pbc']=='row_mic'):return None
 return {'i':i,'j':j,'periodic':periodic}


def ase_reference(spec,values,atoms):
 import ase,numpy as np
 pair=pair_formula(spec,values)
 if not pair:raise ValueError('Automatic ASE reference only supports the exact norm(pos[j]-pos[i]) or norm(mic(pos[j]-pos[i],cell)) formula; choose a separately justified reference for another definition')
 if max(pair['i'],pair['j'])>=len(atoms):raise ValueError('Independent reference indexes exceed the recorded structure')
 if pair['periodic']:
  gram=atoms.cell.array@atoms.cell.array.T
  if not all(atoms.pbc)or not np.allclose(gram,np.diag(np.diag(gram)),atol=1e-10,rtol=0):raise ValueError('ASE closest-image distance and fractional component wrap are certified equivalent here only for fully periodic orthogonal row cells; provide an independent reference for another cell')
 value=float(atoms.get_distance(pair['i'],pair['j'],mic=pair['periodic']))
 return {'values':[value],'provenance':{'kind':'independent_ASE_selected_distance','ase_version':str(ase.__version__),'adapter_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'atom_indices':[pair['i'],pair['j']],'pbc':pair['periodic'],'scope':'Separate ASE geometry implementation for the exact recorded formula/structure. No stable-phase discrimination, pyGAS bias or consuming-engine validation.'}}
