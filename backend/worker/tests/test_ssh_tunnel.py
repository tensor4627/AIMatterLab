"""Injected managed-forward tests. Ack is listener readiness, never target auth."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
if os.name=='posix':
    import studio_worker.compute.ssh_auth as auth
    import test_ssh_auth as fixture_auth
    from studio_worker.compute.ssh_tunnel import SSHTunnels
    from test_ssh_auth import AuthFixture,OWNER,PROFILE,MASTER_PID


@unittest.skipUnless(os.name=='posix','Linux worker capability required')
class ManagedTunnels(unittest.TestCase):
    def fixture(self,retain=True):
        f=AuthFixture(self);view,s=f.verified(retain=retain);tunnels=SSHTunnels(f.manager)
        return f,s,tunnels
    def plan(self,tunnels,**extra):
        return tunnels.plan({'cluster_id':PROFILE['id'],'version':1,'owner':OWNER,'local_port':42420,
                             'destination_host':'target.example.invalid','destination_port':22,**extra})
    def request(self,view,**extra):return {'tunnel_id':view['tunnelId'],'owner':OWNER,**extra}

    def original(self):
        f=fixture_auth.OriginalRunAuthentication.original(self);f.store.profile=copy.deepcopy(f.original_profile)
        view=f.manager.plan({'run_id':'original-run','owner':OWNER})
        f.manager.start(f.request(view,request_id='original-start'));s=f.manager.sessions[view['sessionId']]
        s['masterIdentity']=f.identities[MASTER_PID]
        self.assertTrue(f.manager.read(f.request(view,cursor=0))['authenticated'])
        f.manager.finish(f.request(view,retain=True))
        return f,s,SSHTunnels(f.manager)

    def test_injected_ack_is_only_loopback_listener_ready_and_not_destination_auth(self):
        f,s,t=self.fixture();p=self.plan(t);result=t.start(self.request(p,request_id='forward'))
        self.assertEqual(result['status'],'listener_ready');self.assertEqual(result['destinationVerification'],'not_run');self.assertFalse(result['sshAuthenticated'])
        self.assertNotIn('target.example.invalid',json.dumps(result));argv=[x[1] for x in f.calls if x[0]=='run'][-1]
        self.assertEqual(argv[1:3],['-o','ProxyCommand=/bin/false']);self.assertNotIn('-J',argv);self.assertIn('StrictHostKeyChecking=yes',argv)
        self.assertEqual(argv[argv.index('-O')+1],'forward');self.assertEqual(argv[argv.index('-L')+1],'127.0.0.1:42420:target.example.invalid:22')
        self.assertLess(argv.index('-L'),argv.index('-l'));self.assertEqual(f.store.writes,[])

    def test_verified_private_pane_can_add_optional_forward_before_retaining_but_batch_cannot(self):
        f,s,t=self.fixture(retain=False);p=self.plan(t);self.assertEqual(t.start(self.request(p,request_id='forward'))['status'],'listener_ready')
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(PROFILE)

    def test_port_collision_or_private_failure_is_sanitized_and_does_not_retry(self):
        f,s,t=self.fixture();p=self.plan(t)
        def collision(argv,options):return subprocess.CompletedProcess([],255,b'',b'SYNTHETIC_PRIVATE_TARGET_AND_ERROR')
        f.run_hook=collision;before=len(f.calls);result=t.start(self.request(p,request_id='forward'));self.assertEqual(result['status'],'failed')
        self.assertNotIn('SYNTHETIC',json.dumps(result));again=t.start(self.request(p,request_id='forward'));self.assertEqual(again,result);self.assertEqual(len(f.calls),before+1)

    def test_duplicate_start_uses_one_control_command_and_close_cancels_only_exact_owned_spec(self):
        f,s,t=self.fixture();p=self.plan(t);first=t.start(self.request(p,request_id='forward'));before=len(f.calls)
        self.assertEqual(t.start(self.request(p,request_id='forward')),first);self.assertEqual(len(f.calls),before)
        self.assertEqual(t.close(self.request(p))['status'],'closed');argv=f.calls[-1][1]
        self.assertEqual(argv[argv.index('-O')+1],'cancel');self.assertEqual(argv[argv.index('-L')+1],'127.0.0.1:42420:target.example.invalid:22')
        self.assertTrue(f.manager._live(s));self.assertEqual(f.children[0].terminations,0)

    def test_master_death_marks_listener_lost_without_creating_an_alternate_route(self):
        f,s,t=self.fixture();p=self.plan(t);t.start(self.request(p,request_id='forward'));before=len(f.calls)
        f.identities.pop(MASTER_PID,None);result=t.status(self.request(p));self.assertEqual(result['status'],'lost')
        self.assertEqual(t.close(self.request(p))['status'],'closed');self.assertEqual(len(f.calls),before)

    def test_missing_master_between_control_request_and_ack_never_reports_ready(self):
        f,s,t=self.fixture();p=self.plan(t)
        def died(argv,options):f.identities.pop(MASTER_PID,None);return subprocess.CompletedProcess([],0,b'',b'')
        f.run_hook=died;self.assertEqual(t.start(self.request(p,request_id='forward'))['status'],'failed')

    def test_expired_lease_cannot_start_a_stale_reviewed_forward(self):
        f,s,t=self.fixture();p=self.plan(t);before=len(f.calls);f.clock[0]+=auth.LEASE_SECONDS+1
        result=t.start(self.request(p,request_id='forward'));self.assertEqual(result['status'],'failed');self.assertEqual(s['reason'],'auth_expired');self.assertEqual(len(f.calls),before)

    def test_saved_source_edit_invalidates_pending_forward_but_old_owned_cancel_remains_possible(self):
        f,s,t=self.fixture();pending=self.plan(t);live=self.plan(t,local_port=42421);t.start(self.request(live,request_id='forward'))
        f.store.profile.update(version=2,host='new.example.invalid');before=len(f.calls)
        self.assertEqual(t.start(self.request(pending,request_id='stale-forward'))['status'],'failed');self.assertEqual(len(f.calls),before)
        self.assertEqual(t.close(self.request(live))['status'],'closed');self.assertEqual(f.calls[-1][1][f.calls[-1][1].index('-O')+1],'cancel')

    def test_unknown_or_external_forward_id_and_wrong_owner_never_emit_control_or_kill(self):
        f,s,t=self.fixture();p=self.plan(t);before=len(f.calls)
        for args in ({'tunnel_id':'external-forwarded-entry','owner':OWNER},{**self.request(p),'owner':'b'*48}):
            with self.assertRaises(auth.AuthError):t.close(args)
        self.assertEqual(len(f.calls),before);f.mocks[2].assert_not_called();self.assertEqual(f.children[0].terminations,0)

    def test_plan_owner_must_match_current_owned_auth_pane(self):
        f,s,t=self.fixture()
        with self.assertRaises(auth.AuthError):self.plan(t,owner='b'*48)

    def test_reopen_transfers_only_private_owner_and_lists_owned_forward_without_new_master(self):
        f,s,t=self.fixture();p=self.plan(t);t.start(self.request(p,request_id='forward'));started=len(f.children);verified=s['verifiedClock'];f.clock[0]+=1
        reopened=f.manager.plan({'cluster_id':PROFILE['id'],'version':1,'owner':'b'*48})
        self.assertEqual(reopened['sessionId'],s['id']);self.assertEqual(len(f.children),started);self.assertEqual(s['verifiedClock'],verified)
        self.assertEqual(t.for_session(s['id'])[0]['tunnelId'],p['tunnelId'])
        with self.assertRaises(auth.AuthError):t.close(self.request(p))
        self.assertEqual(t.close({'tunnel_id':p['tunnelId'],'owner':'b'*48})['status'],'closed')

    def test_loopback_only_literal_argv_and_ipv6_destination(self):
        f,s,t=self.fixture();p=self.plan(t,destination_host='2001:db8::1');t.start(self.request(p,request_id='forward'));argv=f.calls[-1][1]
        self.assertEqual(argv[argv.index('-L')+1],'127.0.0.1:42420:[2001:db8::1]:22')
        for extra in ({'bind':'0.0.0.0'},{'local_port':22},{'local_port':True},{'destination_port':0},{'destination_host':'bad;command'},{'destination_host':'-option'}):
            with self.assertRaises(auth.AuthError):self.plan(t,**extra)

    def test_current_profile_auth_cannot_resolve_an_old_version_forward(self):
        f,s,t=self.fixture();f.store.profile.update(version=2,host='new.example.invalid')
        with self.assertRaises(auth.AuthError):self.plan(t,version=2)
        self.assertEqual(len(t.forwards),0)

    def test_same_current_version_original_run_cannot_plan_new_forward_at_worker_boundary(self):
        f,s,t=self.original();before=len(f.calls)
        self.assertEqual(s['profile']['version'],f.store.profile['version']);self.assertFalse(s['newForwardAllowed'])
        with self.assertRaisesRegex(auth.AuthError,'historical_forward_disabled'):self.plan(t)
        self.assertEqual(t.forwards,{});self.assertEqual(len(f.calls),before);self.assertTrue(f.manager._live(s))

    def test_new_forward_checks_both_source_kind_and_capability_flag_not_only_profile_version(self):
        for change in ('flag','source'):
            with self.subTest(change=change):
                f,s,t=self.fixture();before=len(f.calls)
                if change=='flag':s['newForwardAllowed']=False
                else:
                    # Keep resolver inert to isolate source-kind enforcement.
                    s['source']={'kind':'original-run','runId':'inert-original'}
                    f.manager._source_current=lambda _s:True
                with self.assertRaisesRegex(auth.AuthError,'historical_forward_disabled'):self.plan(t)
                self.assertEqual(t.forwards,{});self.assertEqual(len(f.calls),before)

    def test_retained_saved_plan_checks_fresh_source_after_resolve_before_storing_forward(self):
        f,s,t=self.fixture();resolve=f.manager.resolve;before=len(f.calls)
        def changed_after_resolve(*args,**options):
            result=resolve(*args,**options);f.store.profile['host']='changed.example.invalid';return result
        f.manager.resolve=changed_after_resolve
        with self.assertRaisesRegex(auth.AuthError,'saved_connection_changed'):self.plan(t)
        self.assertEqual(t.forwards,{});self.assertEqual(len(f.calls),before)

    def test_forward_dispatch_rechecks_source_kind_and_new_forward_flag_without_control_replay(self):
        for change in ('flag','source'):
            with self.subTest(change=change):
                f,s,t=self.fixture();p=self.plan(t);before=len(f.calls)
                if change=='flag':s['newForwardAllowed']=False
                else:s['source']={'kind':'original-run','runId':'inert-original'}
                result=t.start(self.request(p,request_id='stale-forward'))
                self.assertEqual(result['status'],'failed');self.assertEqual(len(f.calls),before)
                self.assertEqual(t.start(self.request(p,request_id='stale-forward')),result)
                self.assertEqual(len(f.calls),before);self.assertEqual(t.close(self.request(p))['status'],'closed')

    def test_original_context_and_revoked_policy_cannot_start_pending_forward_but_exact_owned_cancel_survives(self):
        f=fixture_auth.OriginalRunAuthentication.original(self);f.store.profile=copy.deepcopy(f.original_profile)
        _view,s=f.verified();t=SSHTunnels(f.manager);pending=self.plan(t);live=self.plan(t,local_port=42421)
        self.assertEqual(t.start(self.request(live,request_id='owned-live'))['status'],'listener_ready')
        original=f.manager.plan({'run_id':'original-run','owner':OWNER})
        self.assertEqual(original['sessionId'],s['id']);self.assertFalse(original['newForwardAllowed'])
        f.store.projects['original-project']['policy']['clusters']=[];before=len(f.calls)
        self.assertEqual(t.start(self.request(pending,request_id='revoked-forward'))['status'],'failed')
        self.assertEqual(len(f.calls),before)
        self.assertEqual(t.close(self.request(live))['status'],'closed')
        self.assertEqual(len(f.calls),before+1);argv=f.calls[-1][1]
        self.assertEqual(argv[argv.index('-O')+1],'cancel');self.assertIn('127.0.0.1:42421:target.example.invalid:22',argv)
        self.assertTrue(f.manager._live(s));self.assertEqual(f.children[0].terminations,0)


if __name__=='__main__':unittest.main()
