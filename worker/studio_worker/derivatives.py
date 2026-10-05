"""Finite-difference evidence for serialized dictionary-ABI biases, not engine parity."""
def check(payload):
 import torch
 import numpy as np
 from ase.io import read
 from ase.neighborlist import neighbor_list
 from pathlib import Path
 from base.artifact import ArtifactRunner
 if str(payload["bias_file"]).endswith(".pt2"):
  raise ValueError("AOTI finite differences require an explicit fixed-capacity target preflight")
 atoms=read(payload["structure_file"])
 device=torch.device("cuda")
 runner=ArtifactRunner(payload["bias_file"],device=device)
 positions=torch.tensor(atoms.positions,device=device,dtype=torch.float64)
 cell=torch.tensor(atoms.cell.array,device=device,dtype=torch.float64)
 i,j=neighbor_list("ij",atoms,payload["cutoff"],self_interaction=False)
 edges=torch.as_tensor(np.stack((i,j),axis=1),device=device,dtype=torch.int64)
 cv_size=int(payload["cv_size"])
 history=np.loadtxt(payload["validation_history"],ndmin=2) if payload.get("validation_history") else np.zeros((0,cv_size+1))
 if history.shape[1]!=cv_size+1:raise ValueError("History columns must be bias followed by CV order")
 def evaluate(pos,box):
  return runner({"positions":pos,"cell":box,"side_array":edges,
   "cv_traj":torch.tensor(history[:,1:],device=device,dtype=torch.float64),
   "bias_traj":torch.tensor(history[:,0],device=device,dtype=torch.float64),
   "saved_cv_nums":torch.tensor(len(history),device=device,dtype=torch.int32)})
 output=evaluate(positions,cell)
 indices=payload.get("atom_selection") or list(range(min(len(atoms),4)))
 if not isinstance(indices,list) or not indices or len(indices)>32 or any(type(x)is not int or x<0 or x>=len(atoms) for x in indices):
  raise ValueError("Finite-difference atom_selection must contain at most 32 explicit indices")
 step=float(payload.get("fd_step",1e-5));tolerance=float(payload.get("fd_atol",1e-4))
 if not 0<step<.01 or not 0<tolerance<.1:raise ValueError("Invalid finite-difference tolerances")
 errors=[]
 for index in indices:
  for axis in range(3):
   plus,minus=positions.clone(),positions.clone();plus[index,axis]+=step;minus[index,axis]-=step
   gradient=(float(evaluate(plus,cell)["bias"].sum())-float(evaluate(minus,cell)["bias"].sum()))/(2*step)
   errors.append(abs(gradient+float(output["forces"][index,axis])))
 gradient=torch.zeros_like(cell)
 for row in range(3):
  for column in range(3):
   plus,minus=cell.clone(),cell.clone();plus[row,column]+=step;minus[row,column]-=step
   gradient[row,column]=(evaluate(positions,plus)["bias"].sum()-evaluate(positions,minus)["bias"].sum())/(2*step)
 expected=(cell.T@(-gradient)).flatten()[torch.tensor([0,4,8,1,2,5,3,6,7],device=device)]
 virial_error=float((expected-output["virial"]).abs().max())
 force_error=max(errors)
 if not np.isfinite(force_error+virial_error) or max(force_error,virial_error)>tolerance:
  raise ValueError(f"Finite differences failed: force={force_error}, virial={virial_error}, atol={tolerance}")
 if "cv_reference" in payload:
  if not np.allclose(output["cv_now"].cpu().numpy(),payload["cv_reference"],atol=tolerance,rtol=0):
   raise ValueError("Declared CV reference does not match serialized model")
 return {"status":"passed","device":"cuda","force_max_abs_error":force_error,"virial_max_abs_error":virial_error,
  "fd_step":step,"atol":tolerance,"force_checked_atom_indices":indices,"cv":output["cv_now"].cpu().tolist(),
  "scope":"Fixed real neighbor graph, sampled atomic forces and dictionary-ABI cell derivative; does not establish dynamics or restart parity"}
