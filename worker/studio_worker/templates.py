"""Explicit pair-distance templates. No inferred atoms, PBC, or physical parameters."""
import json


def build_bias(p):
    for key in ("family", "atom_i", "atom_j", "output_file"):
        if p.get(key) is None:
            raise ValueError("Missing scientific parameter: " + key)
    if type(p["atom_i"]) is not int or type(p["atom_j"]) is not int or min(p["atom_i"], p["atom_j"]) < 0:
        raise ValueError("Zero-based nonnegative atom indices required")
    if p["atom_i"] == p["atom_j"]:
        raise ValueError("Choose distinct atoms")
    family = p["family"]
    required = {"metad": ("sigma", "height"), "wtmetad": ("sigma", "height", "temperature", "bias_factor"),
                "umbrella": ("center", "force_constant"), "wall": ("lower", "upper", "force_constant")}
    if family not in required:
        raise ValueError("Unsupported bias template")
    for name in required[family]:
        if name not in p or p[name] is None:
            raise ValueError("Missing scientific parameter: " + name)
    if family in ("metad", "wtmetad") and (p["sigma"] <= 0 or p["height"] <= 0):
        raise ValueError("Positive sigma and hill height required")
    if family == "wtmetad" and (p["temperature"] <= 0 or p["bias_factor"] <= 1):
        raise ValueError("WTMetaD requires temperature > 0 and bias factor > 1")
    if family in ("umbrella", "wall") and p["force_constant"] < 0:
        raise ValueError("Force constant must be nonnegative")
    if family == "wall" and p["lower"] > p["upper"]:
        raise ValueError("Lower wall exceeds upper wall")
    static = family in ("umbrella", "wall")
    construct = {
      "metad": "self.bias_layer = MetaDGaussianBias(t([C['sigma']]), t([C['height']]), t([1.0]))",
      "wtmetad": "self.bias_layer = WTMetaDGaussianBias(t([C['sigma']]), t([C['height']]), t([1.0]), temp=C['temperature'], bias_factor=C['bias_factor'])",
      "umbrella": "self.bias_layer = FlexibleWallBias(t([C['center']]), t([C['center']]), t([C['force_constant']]), t([C['force_constant']]), t([0.0]), t([0.0]), interval=1, lgrow=0, ugrow=0)",
      "wall": "self.bias_layer = FlexibleWallBias(t([C['lower']]), t([C['upper']]), t([C['force_constant']]), t([C['force_constant']]), t([0.0]), t([0.0]), interval=1, lgrow=0, ugrow=0)"
    }[family]
    base = "MetaDProcedure" if static else "WTMetaDProcedure"
    signature = "pos, cell, side_array, cv_traj" + ("" if static else ", bias_traj")
    call = "self.bias_layer(cv, cv_traj)" + ("" if static else "") if static else "self.bias_layer(cv, cv_traj, bias_traj)"
    return f'''import json
import torch
from ase.io import read
from base import MetaDProcedure, WTMetaDProcedure, MetaDGaussianBias, WTMetaDGaussianBias, FlexibleWallBias

C = json.loads({json.dumps(json.dumps(p))})
def t(x):
    return torch.tensor(x, dtype=torch.float64)

class PairDistanceBias({base}):
    def __init__(self):
        super().__init__({{"Settings": {{"cv_internal_dtype": None}}}})
        self.atom_i = C["atom_i"]
        self.atom_j = C["atom_j"]
        self.cv_dim = 1
        {construct}

    def _cal_bias(self, {signature}):
        delta = pos[self.atom_j] - pos[self.atom_i]
        fractional = delta @ torch.linalg.inv(cell)
        delta = (fractional - torch.round(fractional)) @ cell
        cv = torch.linalg.vector_norm(delta).reshape(1)
        bias = {call}
        return bias + 0.0 * pos.sum() + 0.0 * cell.sum(), cv.detach().clone()

if __name__ == "__main__":
    atoms = read(C["structure_file"])
    if not all(atoms.pbc):
        raise ValueError("Pair-distance template requires explicitly chosen full 3D PBC")
    if max(C["atom_i"], C["atom_j"]) >= len(atoms):
        raise ValueError("Atom index exceeds structure")
    model = torch.jit.script(PairDistanceBias().double().eval())
    model.save(C["output_file"])
    torch.jit.load(C["output_file"])
    print("Saved and reloaded", C["output_file"])
'''
