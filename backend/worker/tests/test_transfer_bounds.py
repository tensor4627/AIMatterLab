import base64
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.compute.cluster import TRANSFER_CHUNK, TRANSFER_PROGRAM, TRANSFER_TOTAL

# The HTTP transport refuses responses at 4 MiB; a chunk response is base64 plus
# a small JSON envelope, so the remote/local chunk size must stay below it.
TRANSPORT_RESPONSE_BOUND = 4 * 1024 * 1024


class TransferBoundsTest(unittest.TestCase):
    def test_remote_and_local_chunk_size_match(self):
        remote = int(re.search(r"CHUNK=(\d+)", TRANSFER_PROGRAM).group(1))
        self.assertEqual(remote, TRANSFER_CHUNK)

    def test_remote_and_local_total_size_match(self):
        remote = int(re.search(r"TOTAL=(\d+)", TRANSFER_PROGRAM).group(1))
        self.assertEqual(remote, TRANSFER_TOTAL)

    def test_a_full_chunk_response_fits_the_transport_bound(self):
        response = base64.b64encode(b"x" * TRANSFER_CHUNK)
        self.assertLess(len(response) + 4096, TRANSPORT_RESPONSE_BOUND)

    def test_chunk_size_reduces_ssh_round_trips_for_bounded_files(self):
        # 128 MiB is the maximum transfer; keep it under 100 sessions.
        self.assertGreaterEqual(TRANSFER_TOTAL // TRANSFER_CHUNK, 1)
        self.assertLess(TRANSFER_TOTAL // TRANSFER_CHUNK, 100)
        self.assertGreaterEqual(TRANSFER_CHUNK, 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
