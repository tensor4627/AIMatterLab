"""Ready is a local observation, never a remote authentication attempt."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch


source = Path(__file__).resolve().parents[2] / 'desktop/platform/terminal-service/ssh-multiplex-helper.py'
spec = importlib.util.spec_from_file_location('studio_multiplex_ready', source)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class LocalReadyTests(unittest.TestCase):
    def setUp(self):
        self.profile = {'fixture': 'inert'}
        self.proof = {'socket': '/tmp/inert-ready/master.sock'}
        self.master = {'pid': 123, 'start': '1', 'boot': 'inert'}
        self.argv = ['helper', 'ready', json.dumps({'profile': self.profile, 'proof': self.proof, 'master': self.master})]

    def test_absent_socket_is_pending_without_client_or_remote_probe(self):
        with patch.object(sys, 'argv', self.argv), patch.object(helper, 'private') as private, patch.object(helper.os, 'lstat', side_effect=FileNotFoundError), patch.object(helper, 'check') as check, patch.object(helper, 'run') as run:
            self.assertEqual(helper.main(), {'ready': False})
            private.assert_called_once_with(self.proof)
            check.assert_not_called()
            run.assert_not_called()

    def test_ready_uses_existing_control_proof_with_authenticate_default_false(self):
        with patch.object(sys, 'argv', self.argv), patch.object(helper, 'private'), patch.object(helper.os, 'lstat'), patch.object(helper, 'check') as check:
            self.assertEqual(helper.main(), {'ready': True})
            check.assert_called_once_with(self.profile, self.proof, self.master)

    def test_control_socket_not_yet_accepting_is_pending(self):
        with patch.object(sys, 'argv', self.argv), patch.object(helper, 'private'), patch.object(helper.os, 'lstat'), patch.object(helper, 'check', side_effect=helper.Refused('ssh_master_unavailable')):
            self.assertEqual(helper.main(), {'ready': False})

    def test_foreign_master_or_socket_identity_cannot_become_ready(self):
        for code in ('ssh_master_identity_changed', 'ssh_control_identity_changed'):
            with self.subTest(code=code), patch.object(sys, 'argv', self.argv), patch.object(helper, 'private'), patch.object(helper.os, 'lstat'), patch.object(helper, 'check', side_effect=helper.Refused(code)):
                with self.assertRaisesRegex(helper.Refused, code):
                    helper.main()


@unittest.skipUnless(os.name == 'posix' and Path('/proc/self/cmdline').exists(), 'Linux /proc and Unix socket ownership proof')
class ExactLocalProofTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='studio-ssh-mux-', dir='/tmp'))
        self.root.chmod(0o700)
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(str(self.root/'master.sock'))
        self.addCleanup(self.cleanup)
        info, endpoint = self.root.stat(), (self.root/'master.sock').lstat()
        self.master = helper.process_identity(os.getpid())
        self.profile = {'username': 'login-alias', 'host': 'inert.invalid', 'ssh_client': sys.executable}
        self.proof = {'root': str(self.root), 'socket': str(self.root/'master.sock'), 'directoryIdentity': [str(info.st_dev), str(info.st_ino)], 'clientIdentity': helper.client_identity(sys.executable), 'targetDigest': 'inert-exact-target', 'socketIdentity': [str(endpoint.st_dev), str(endpoint.st_ino)]}
        self.argv = Path('/proc/self/cmdline').read_bytes().decode().rstrip('\x00').split('\x00')
        self.capability = {key: self.proof[key] for key in ('clientIdentity', 'targetDigest')}

    def cleanup(self):
        self.socket.close()
        (self.root/'master.sock').unlink(missing_ok=True)
        self.root.rmdir()

    def observed(self, *, run=None, capability=None, master=None):
        def arguments(profile, endpoint, master=False, control=None, tty=False):
            return self.argv if master else ['/fixture/ssh', '-o', 'ProxyCommand=/bin/false', '-O', control]
        def control(argv, **kwargs):
            self.assertEqual(argv, ['/fixture/ssh', '-o', 'ProxyCommand=/bin/false', '-O', 'check'])
            return (0, b'', ('Master running (pid=%s)\n' % os.getpid()).encode())
        with patch.object(helper, 'describe', return_value=self.capability if capability is None else capability), patch.object(helper, 'args', side_effect=arguments), patch.object(helper, 'run', side_effect=run or control) as request:
            result = helper.check(self.profile, self.proof, self.master if master is None else master)
            self.assertEqual(request.call_count, 1)
            return result

    def test_alias_authentication_uses_only_exact_local_control_without_remote_exec(self):
        self.assertEqual(self.observed(), {'socketIdentity': self.proof['socketIdentity']})

    def test_wrong_host_or_original_pid_start_cannot_be_authenticated(self):
        for change in ({'capability': {**self.capability, 'targetDigest': 'another-target'}}, {'master': {**self.master, 'start': '0'}}):
            with self.subTest(change=change), self.assertRaisesRegex(helper.Refused, 'ssh_master_identity_changed'):
                self.observed(**change)

    def test_wrong_socket_inode_or_private_directory_identity_cannot_be_authenticated(self):
        for key in ('socketIdentity', 'directoryIdentity'):
            previous = self.proof[key]
            self.proof[key] = ['0', '0']
            with self.subTest(key=key), self.assertRaisesRegex(helper.Refused, 'ssh_control_identity_changed'):
                self.observed()
            self.proof[key] = previous

    def test_control_ack_does_not_accept_a_socket_replaced_during_observation(self):
        def swapped(argv, **kwargs):
            original = self.socket
            self.addCleanup(original.close)
            (self.root/'master.sock').unlink()
            self.socket = socket.socket(socket.AF_UNIX)
            self.socket.bind(str(self.root/'master.sock'))
            return (0, b'', ('Master running (pid=%s)\n' % os.getpid()).encode())
        with self.assertRaisesRegex(helper.Refused, 'ssh_control_identity_changed'):
            self.observed(run=swapped)

    def test_wrong_control_ack_pid_fails_without_remote_fallback(self):
        with self.assertRaisesRegex(helper.Refused, 'ssh_master_unavailable'):
            self.observed(run=lambda *args, **kwargs: (0, b'', b'Master running (pid=1)\n'))


if __name__ == '__main__':
    unittest.main()
