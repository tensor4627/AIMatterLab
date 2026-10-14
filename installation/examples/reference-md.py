"""Independent CPU reference MD. This does not validate PyDyn or GPUMD."""
import json
from pathlib import Path
import numpy as np
from ase import units
from ase.build import bulk
from ase.calculators.emt import EMT
from ase.md.verlet import VelocityVerlet
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from ase.io import write
atoms=bulk("Cu","fcc",a=3.62,cubic=True).repeat((2,2,2))
atoms.calc=EMT()
MaxwellBoltzmannDistribution(atoms,temperature_K=300,rng=np.random.RandomState(42))
start=atoms.positions.copy()
dyn=VelocityVerlet(atoms,timestep=.1*units.fs)
dyn.run(5)
energy=float(atoms.get_potential_energy())
assert len(atoms)==32 and np.isfinite(energy) and np.isfinite(atoms.get_forces()).all()
assert np.linalg.norm(atoms.positions-start)>0
write("final.xyz",atoms)
Path("smoke-result.json").write_text(json.dumps({"status":"passed","case":"reference-md","scope":"ASE EMT reference; no engine or model accuracy claim","atoms":32,"steps":5,"finite_energy":True,"moved":True}))
print("STUDIO_REFERENCE_MD_OK",flush=True)
