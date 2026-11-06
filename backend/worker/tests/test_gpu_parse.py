import subprocess
import sys
import unittest
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.transport.routes import parse_gpu_rows


class GpuInventoryParseTest(unittest.TestCase):
    def test_standard_rows_parse(self):
        rows = parse_gpu_rows("0, NVIDIA GeForce RTX 4090, 1024, 24564, 12\n1, NVIDIA A100, 0, 40960, 0\n")
        self.assertEqual(rows, [
            {"id": 0, "name": "NVIDIA GeForce RTX 4090", "memory_used": 1024,
             "memory_total": 24564, "utilization": 12},
            {"id": 1, "name": "NVIDIA A100", "memory_used": 0, "memory_total": 40960, "utilization": 0},
        ])

    def test_irregular_spacing_blank_lines_and_crlf_are_tolerated(self):
        rows = parse_gpu_rows(" 0 ,  GPU X ,  7 ,  8 ,  9 \r\n\r\n")
        self.assertEqual(rows[0]["name"], "GPU X")
        self.assertEqual(rows[0]["memory_used"], 7)
        self.assertEqual(len(rows), 1)

    def test_non_numeric_counters_become_null_instead_of_failing_inventory(self):
        rows = parse_gpu_rows("0, MIG 1g.5gb, [N/A], 4864, [N/A]\n")
        self.assertEqual(rows[0]["memory_used"], None)
        self.assertEqual(rows[0]["utilization"], None)
        self.assertEqual(rows[0]["memory_total"], 4864)

    def test_unparseable_output_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_gpu_rows("not nvidia output")
        with self.assertRaises(ValueError):
            parse_gpu_rows("x, GPU, 1, 2, 3")

    def test_empty_output_is_an_empty_inventory(self):
        self.assertEqual(parse_gpu_rows(""), [])
        self.assertEqual(parse_gpu_rows(None), [])


if __name__ == "__main__":
    unittest.main()

from studio_worker.transport.routes import gpu_inventory


class GpuInventoryAvailabilityTest(unittest.TestCase):
    def test_successful_inventory_is_parsed(self):
        def run(*args, **kwargs):
            self.assertIn("nvidia-smi", args[0][0])
            return SimpleNamespace(returncode=0, stdout="0, GPU A, 1, 2, 3\n", stderr="")
        self.assertEqual(gpu_inventory(run)[0]["name"], "GPU A")

    def test_missing_or_timed_out_driver_is_an_empty_inventory(self):
        for error in (FileNotFoundError("nvidia-smi"), subprocess.TimeoutExpired("nvidia-smi", 10), OSError("unavailable")):
            with self.subTest(error=type(error).__name__):
                def run(*args, _error=error, **kwargs):
                    raise _error
                self.assertEqual(gpu_inventory(run), [])

    def test_nonzero_exit_is_an_empty_inventory(self):
        def run(*args, **kwargs):
            return SimpleNamespace(returncode=9, stdout="", stderr="driver not loaded")
        self.assertEqual(gpu_inventory(run), [])
