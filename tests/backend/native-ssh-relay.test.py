"""Run the Linux relay and verify real child exit receipts."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest


source = Path(__file__).resolve().parents[2] / 'desktop/platform/terminal-service/native-ssh-relay.py'


@unittest.skipUnless(sys.platform == 'linux' and os.access('/bin/sh', os.X_OK), 'Linux SSH relay required')
class NativeRelayTests(unittest.TestCase):
    def test_eof_and_cancellation_preserve_independent_exit_receipts(self):
        requests = [
            ['open', 'early-eof', 100, 30, 'printf before; exec 0<&- 1>&- 2>&-; sleep .15; exit 0'],
            ['exec', 'plain', 'test ! -t 0 && test ! -t 1 && printf plain; exit 7'],
            ['exec', 'cancelled', 'sleep 4; printf unexpected'],
            ['exec', 'other', 'sleep .25; printf other'],
            ['close', 'cancelled'],
        ]
        with subprocess.Popen([sys.executable, '-u', str(source), 'fixture'], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, text=True) as relay:
            deadline = threading.Timer(5, relay.kill)
            deadline.start()
            try:
                self.assertEqual(json.loads(relay.stdout.readline()), ['ready', 'fixture'])
                relay.stdin.write(''.join(json.dumps(request) + '\n' for request in requests))
                relay.stdin.flush()
                receipts, output = {}, {}
                while len(receipts) < 4:
                    line = relay.stdout.readline()
                    self.assertTrue(line, 'relay stopped before returning all exit receipts')
                    event, channel, *args = json.loads(line)
                    if event == 'data':
                        output[channel] = output.get(channel, b'') + base64.b64decode(args[0])
                    if event == 'exit':
                        receipts[channel] = args[0]
                self.assertEqual({k: receipts[k] for k in ['early-eof', 'plain', 'other']},
                                 {'early-eof': 0, 'plain': 7, 'other': 0})
                self.assertEqual(output, {'early-eof': b'before', 'plain': b'plain', 'other': b'other'})
            finally:
                relay.stdin.close()
                relay.wait()
                deadline.cancel()


if __name__ == '__main__':
    unittest.main()
