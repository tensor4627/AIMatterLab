"""Numerical-check controls never alter the CV definition or engine input."""
import math
KEYS={'atom_selection','fd_step','fd_atol'}

def validate_controls(parameters,engine=None):
 if engine in ('gpumd.sampling','pydyn.sampling','bias.validate') and parameters.get('mode')=='opes' and ('validation' in parameters or 'fd_step' in parameters or 'fd_atol' in parameters):
  raise ValueError('OPES stateful finite-difference validation is not implemented; explicit validation, fd_step or fd_atol controls cannot be accepted. Remove numerical controls only if serialized ABI/state checks alone are intended; CV atom_selection is unchanged.')
 value=parameters.get('validation',{})
 if not isinstance(value,dict) or set(value)-KEYS:raise ValueError('Only explicit numerical validation controls are allowed in validation')
 if value and engine is not None and engine not in ('gpumd.sampling','pydyn.sampling','bias.validate'):raise ValueError('Numerical validation controls apply only to serialized sampling/bias validation')
 if 'atom_selection' in value:
  indices=value['atom_selection']
  if not isinstance(indices,list) or not 1<=len(indices)<=32 or any(type(v)is not int or v<0 for v in indices) or len(set(indices))!=len(indices):raise ValueError('validation.atom_selection requires 1..32 distinct nonnegative indices; it is not the CV atom group')
 for key,maximum in (('fd_step',.01),('fd_atol',.1)):
  if key in value:
   number=value[key]
   if type(number) not in (int,float) or not math.isfinite(number) or not 0<number<maximum:raise ValueError('Invalid numerical validation '+key)
   if key in parameters and parameters[key]!=number:raise ValueError('Conflicting legacy and nested validation '+key)
 return value

def cv_atoms(parameters):
 """Resolve only declared atom-group aliases; never numerical FD indexes."""
 cv=parameters.get('cv',{})
 if not isinstance(cv,dict):raise ValueError('CV parameter group must be an object')
 candidates=[value for value in (parameters.get('atom_selection'),cv.get('atom_selection'),cv.get('atoms_zero_based')) if value is not None]
 if any(not isinstance(value,list)or not value or any(type(index)is not int or index<0 for index in value) for value in candidates):raise ValueError('Declared CV atom_selection aliases require nonempty lists of nonnegative integers')
 if any(value!=candidates[0] for value in candidates[1:]):raise ValueError('Conflicting declared CV atom_selection aliases')
 return candidates[0] if candidates else None

def selection(parameters,n_atoms):
 controls=validate_controls(parameters);full=cv_atoms(parameters)
 if full is not None and (not isinstance(full,list) or any(type(i)is not int or not 0<=i<n_atoms for i in full)):raise ValueError('CV atom_selection provenance must use actual structure indices')
 if 'atom_selection' in controls:
  indices=controls['atom_selection'];source='explicit validation.atom_selection; CV atom_selection unchanged'
 elif full:
  unique=list(dict.fromkeys(full))
  if len(unique)<=32:indices=unique;source='all distinct declared CV atoms; CV definition unchanged'
  else:
   indices=[unique[round(i*(len(unique)-1)/7)] for i in range(8)];source='deterministic bounded sample of 8 declared CV atoms; not all-atom finite differences'
 else:indices=list(range(min(n_atoms,4)));source='legacy bounded first-four default; CV group not inferred'
 if not indices or any(i>=n_atoms for i in indices):raise ValueError('Numerical validation indices exceed the actual structure')
 return {'indices':indices,'source':source,'structure_atoms':n_atoms,'declared_cv_atoms':full,'scope':'Only the listed atomic force components are finite-differenced. CV input structure/group and full serialized forces/virial remain unchanged.'}


def validate_cell_group(contract,parameters,n_atoms):
 """Trusted worker proof only; Adapter overwrites caller-supplied contracts."""
 declared=contract.get('declared_cv_atoms');private=contract.get('private_cv_bindings',[])
 if private:
  proof=contract.get('private_cv_atom_contract',{})
  if len(private)!=1 or proof.get('kind')!='approved_private_formula_group'or proof.get('structure_atoms')!=n_atoms or proof.get('atom_selection')!=declared or cv_atoms(parameters)!=declared:raise ValueError('Worker private formula atom-group proof differs from actual validation inputs')
  if not isinstance(declared,list)or not declared or len(set(declared))!=len(declared)or any(type(index)is not int or not 0<=index<n_atoms for index in declared):raise ValueError('Invalid exact private formula group')
  referenced=proof.get('referenced_atoms')
  if not isinstance(referenced,list)or not referenced or any(type(index)is not int or index not in declared for index in referenced)or len(set(referenced))!=len(referenced):raise ValueError('Private formula references differ from its approved group')
  if any(proof.get(key)!=private[0].get(key)for key in('spec_sha256','code_sha256','parameters_sha256')):raise ValueError('Private atom-group proof refers to a different approved revision')
 elif declared!=list(range(n_atoms)):raise ValueError('Native affine proof requires the full actual CV group')
 return declared
