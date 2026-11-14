"""Gateway username validation only; no SSH connections or credentials."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('gateway_helper',Path(__file__).resolve().parents[2]/'desktop/platform/terminal-service/ssh-multiplex-helper.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
class GatewayProfileTests(unittest.TestCase):
    def profile(self,username):
        return dict(host='gateway.invalid',username=username,port=22,ssh_client='/usr/bin/ssh',identity_file='',proxy_jump=[])
    def test_asset_route_is_a_single_literal_login(self):
        username='fixture/10.20.30.40/self';profile=self.profile(username);helper.profile_valid(profile)
        argv=helper.args(profile,'/tmp/owned.sock',tty=True)
        self.assertEqual(argv[argv.index('-l')+1],username)
    def test_malformed_routes_and_shell_input_fail(self):
        for username in ['fixture/host','fixture//self','fixture/host/','fixture/host/self/extra','fixture/host/self;id','fixture/host/$(id)','fixture/host/self\nextra']:
            with self.subTest(username=username),self.assertRaises(helper.Refused):helper.profile_valid(self.profile(username))
if __name__=='__main__':unittest.main()
