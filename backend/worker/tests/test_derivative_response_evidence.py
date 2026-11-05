"""Observation-only return/capture tests; not a TorchScript, CUDA or FD scientific run."""
import ast
import copy
import json
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "studio_worker" / "tools" / "derivatives.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
CHECK = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "check")
CAPTURE = next(node for node in CHECK.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "response_evidence" for target in node.targets))
RETURN = CHECK.body[-1]
assert isinstance(RETURN, ast.Return)
CAPTURE_CODE = compile(ast.fix_missing_locations(ast.Module(body=[copy.deepcopy(CAPTURE)], type_ignores=[])), str(SOURCE), "exec")
RETURN_CODE = compile(ast.fix_missing_locations(ast.Expression(body=copy.deepcopy(RETURN.value))), str(SOURCE), "eval")


class TensorValues:
    """Small synthetic tensor-shaped data for the actual observation expressions only."""
    def __init__(self, values):
        self.values = copy.deepcopy(values)

    def __getitem__(self, key):
        if isinstance(key, tuple):
            value = self.values
            for component in key:
                value = value[component]
            return value
        return self.values[key]

    def flatten(self):
        values = []
        def visit(value):
            if isinstance(value, list):
                for item in value:
                    visit(item)
            else:
                values.append(value)
        visit(self.values)
        return TensorValues(values)

    def sum(self):
        return sum(self.flatten().values)

    def cpu(self):
        return self

    def tolist(self):
        return copy.deepcopy(self.values)


def context(indices=None, count=4, zero=False, rows=2):
    indices = [3, 0, 1] if indices is None else indices
    output = {
        "bias": TensorValues([0.0] if zero else [0.125, -0.025]),
        "forces": TensorValues([[0.0, 0.0, 0.0] if zero else [float(i + 1), -(i + 0.5), 0.25] for i in range(count)]),
        "virial": TensorValues([0.0] * 9 if zero else [float(i) / 10 for i in range(9)]),
        "cv_now": TensorValues([2.5]),
        "ungranted_extra": "NEVER_COPY_UNRELATED_OUTPUT",
    }
    return {
        "output": output, "indices": indices, "history": [[0.0004, 2.45] for _ in range(rows)],
        "force_error": 0.0, "virial_error": 0.0, "convention": "fixed_fractional_positions",
        "contract": None, "step": 1e-5, "tolerance": 1e-4, "coverage": {"indices": list(indices)},
        "payload": {"cv_reference": [99999], "bias_file": "MUST_NOT_COPY_PATH", "reference_bias": 88888},
    }


def captured(value):
    exec(CAPTURE_CODE, value)
    return value


def result(value):
    return eval(RETURN_CODE, value)


class DerivativeResponseEvidence(unittest.TestCase):
    def test_actual_output_quantities_are_copied_not_reference_values(self):
        value = captured(context())
        evidence = result(value)["response_evidence"]
        self.assertAlmostEqual(evidence["bias_sum"], 0.1)
        self.assertEqual(evidence["force_atom_indices"], [3, 0, 1])
        self.assertEqual(evidence["force_vectors"], [[4.0, -3.5, 0.25], [1.0, -0.5, 0.25], [2.0, -1.5, 0.25]])
        self.assertEqual(evidence["force_max_abs"], 4.0)
        self.assertEqual(evidence["virial"], [float(i) / 10 for i in range(9)])
        self.assertEqual(evidence["virial_max_abs"], 0.8)
        self.assertEqual(evidence["validation_history_rows"], 2)
        serialized = json.dumps(evidence, allow_nan=False)
        for value in ("99999", "88888", "MUST_NOT_COPY_PATH", "NEVER_COPY_UNRELATED_OUTPUT", "cv_reference"):
            self.assertNotIn(value, serialized)

    def test_capture_stays_initial_when_later_forward_reuses_output_buffers(self):
        value = captured(context())
        before = copy.deepcopy(value["response_evidence"])
        value["output"]["bias"].values[:] = [999.0]
        value["output"]["forces"].values[:] = [[777.0] * 3 for _ in range(4)]
        value["output"]["virial"].values[:] = [666.0] * 9
        value["history"][:] = [[555.0, 444.0]] * 5
        value["indices"][:] = [2]
        evidence = result(value)["response_evidence"]
        for key, actual in before.items():
            self.assertEqual(evidence[key], actual)
        self.assertEqual(evidence["cell_derivative_convention"], "fixed_fractional_positions")

    def test_selected_only_maximum_and_existing_32_atom_bound(self):
        indices = list(reversed(range(32)))
        value = context(indices=indices, count=108)
        value["output"]["forces"].values[100] = [1e30, -1e30, 1e30]
        evidence = result(captured(value))["response_evidence"]
        self.assertEqual(evidence["force_atom_indices"], indices)
        self.assertEqual(len(evidence["force_vectors"]), 32)
        self.assertTrue(all(len(vector) == 3 for vector in evidence["force_vectors"]))
        self.assertEqual(evidence["force_max_abs"], 32.0)
        self.assertEqual(len(evidence["virial"]), 9)
        self.assertNotIn("1e+30", json.dumps(evidence))
        self.assertLess(len(json.dumps(evidence).encode()), 8192)

    def test_legitimate_zero_response_remains_zero_without_new_success_gate(self):
        value = result(captured(context(zero=True, rows=0)))
        evidence = value["response_evidence"]
        self.assertEqual(value["status"], "passed")
        self.assertEqual(evidence["bias_sum"], 0.0)
        self.assertEqual(evidence["force_max_abs"], 0.0)
        self.assertEqual(evidence["virial_max_abs"], 0.0)
        self.assertEqual(evidence["validation_history_rows"], 0)
        self.assertEqual(evidence["virial"], [0.0] * 9)

    def test_missing_bias_is_not_filled_with_zero(self):
        value = context()
        del value["output"]["bias"]
        with self.assertRaises(KeyError):
            captured(value)

    def test_missing_forces_are_not_filled_with_zero(self):
        value = context()
        del value["output"]["forces"]
        with self.assertRaises(KeyError):
            captured(value)

    def test_missing_virial_is_not_filled_with_zero(self):
        value = context()
        del value["output"]["virial"]
        with self.assertRaises(KeyError):
            captured(value)

    def test_unavailable_actual_components_are_not_filled_with_zero(self):
        for field, invalid in (("forces", [[1.0, 2.0]] * 4), ("virial", [1.0] * 8)):
            value = context()
            value["output"][field] = TensorValues(invalid)
            with self.subTest(field=field), self.assertRaises(IndexError):
                captured(value)

    def test_computed_cell_convention_is_reported_and_no_contract_is_invented(self):
        for convention in ("fixed_fractional_positions", "fixed_cartesian_positions_legacy_literal_ABI"):
            value = captured(context())
            value["convention"] = convention
            evidence = result(value)["response_evidence"]
            self.assertEqual(evidence["cell_derivative_convention"], convention)
            self.assertIn("Initial unperturbed serialized output", evidence["scope"])
            self.assertIn("No minimum-response", evidence["scope"])
            self.assertNotIn("reference", set(evidence))

    def test_copied_quantities_are_plain_json_primitives_with_closed_keys(self):
        evidence = result(captured(context()))["response_evidence"]
        self.assertEqual(set(evidence), {
            "bias_sum", "force_atom_indices", "force_vectors", "force_max_abs", "virial",
            "virial_max_abs", "validation_history_rows", "scope", "cell_derivative_convention",
        })
        self.assertIs(type(evidence["bias_sum"]), float)
        self.assertIs(type(evidence["force_max_abs"]), float)
        self.assertIs(type(evidence["virial_max_abs"]), float)
        self.assertIs(type(evidence["validation_history_rows"]), int)
        self.assertTrue(all(type(component) is float for vector in evidence["force_vectors"] for component in vector))
        self.assertTrue(all(type(component) is float for component in evidence["virial"]))
        json.dumps(evidence, allow_nan=False)

    def test_capture_precedes_fd_loop_and_adds_no_forward_call(self):
        first_loop = next(index for index, node in enumerate(CHECK.body) if isinstance(node, ast.For))
        capture_index = CHECK.body.index(CAPTURE)
        self.assertLess(capture_index, first_loop)
        self.assertFalse(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("evaluate", "runner") for node in ast.walk(CAPTURE)))
        self.assertIsInstance(CHECK.body[capture_index - 1], ast.If)


if __name__ == "__main__":
    unittest.main()

