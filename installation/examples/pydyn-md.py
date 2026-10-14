"""Real PyDyn public-API CUDA short case; 32 Cu atoms, EMT, five NVE steps."""
import json
from pathlib import Path
import cupy as cp
import numpy as np
from ase.build import bulk
from pydyn.state import State
from pydyn.context import SimulationContext
from pydyn.constraints import RemoveCOMMomentum
from pydyn.dynamics import Simulation,VelocityVerlet,MaxwellBoltzmannDistribution
from pydyn.forces.emt_force import EMTForceModel
from pydyn.forces.evaluator import ForceEvaluator
from pydyn.forces.properties import POTENTIAL_ENERGY
cp.random.seed(42)
state=State().from_atoms(bulk("Cu","fcc",a=3.62,cubic=True).repeat((2,2,2)))
start=cp.asnumpy(state.r).copy()
evaluator=ForceEvaluator.from_model(EMTForceModel())
sim=Simulation(state=state,context=SimulationContext(target_temp=300,constraints=[RemoveCOMMomentum()]),dt=.0001,
 initializer=[MaxwellBoltzmannDistribution(300)],ensemble=VelocityVerlet(force_evaluator=evaluator))
sim.run(5)
energy=float(evaluator.compute(sim.state,sim.conditions,properties=[POTENTIAL_ENERGY])[POTENTIAL_ENERGY])
end=cp.asnumpy(state.r)
assert end.shape==(32,3) and np.isfinite(energy) and np.isfinite(end).all()
assert np.linalg.norm(end-start)>0
sim.finalize()
Path("smoke-result.json").write_text(json.dumps({"status":"passed","case":"pydyn-md","scope":"PyDyn CUDA EMT interface short case; no trained-force-field accuracy claim","atoms":32,"steps":5,"finite_energy":True,"moved":True}))
print("STUDIO_PYDYN_MD_OK",flush=True)
