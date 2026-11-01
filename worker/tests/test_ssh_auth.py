"""Injected auth contracts; opt-in null-config ssh -G only, never connections."""
import base64
import copy
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if os.name == 'posix':
    import studio_worker.ssh_auth as auth

OWNER = 'a'*48
HELPER_PID, MASTER_PID = 990000001, 990000002
PROFILE = {'id':'fixture-connection','version':1,'name':'Fixture connection','host':'compute.example.invalid',
           'username':'fixtureuser','target':'fixtureuser@compute.example.invalid','port':2201,
           'ssh_client':'/fixture/native-ssh','identity_file':'/fixture/key-reference',
           'proxy_jump':['fixture_jump@jump.example.invalid:2201'],'via':[],'auth_mode':'interactive'}
CAPABILITY = {'digest':'fixed-effective-config','clientIdentity':['/fixture/native-ssh',1,2,3,4],
              'proxyJump':'fixture_jump@jump.example.invalid:2201'}


class Sink:
    def __init__(self):self.values=[];self.closed=False
    def write(self, value):
        if self.closed:raise BrokenPipeError('SYNTHETIC_PRIVATE_PIPE_DETAIL')
        self.values.append(bytes(value));return len(value)
    def flush(self):pass
    def close(self):self.closed=True


class Folder:
    def __init__(self):self.removals=0
    def __str__(self):return '/fixture/control'
    def lstat(self):return SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=os.getuid(),st_dev=11,st_ino=12)
    def __truediv__(self, value):return SimpleNamespace(exists=lambda:False)
    def rmdir(self):self.removals+=1


class Helper:
    def __init__(self):self.pid=HELPER_PID;self.stdin=Sink();self.stdout=io.BytesIO();self.code=None;self.terminations=0;self.waits=0;self.kills=0;self.wait_timeouts=0
    def poll(self):return self.code
    def terminate(self):self.terminations+=1;self.code=-15
    def kill(self):self.kills+=1;self.code=-9
    def wait(self,timeout=None):
        self.waits+=1
        if self.wait_timeouts:
            self.wait_timeouts-=1;raise subprocess.TimeoutExpired(['/fixture/helper'],timeout)
        if self.code is None:self.code=0
        return self.code


class Store:
    def __init__(self):self.profile=copy.deepcopy(PROFILE);self.writes=[];self.runs={};self.projects={};self.lock=threading.RLock()
    def get(self, kind, identifier):
        if kind=='cluster' and identifier==self.profile['id']:return copy.deepcopy(self.profile)
        if kind=='cluster-run' and identifier in self.runs:return copy.deepcopy(self.runs[identifier])
        if kind=='project' and identifier in self.projects:return copy.deepcopy(self.projects[identifier])
        raise KeyError('unavailable')
    def put(self,*args):self.writes.append(args);raise AssertionError('Auth must not persist')


class AuthFixture:
    def __init__(self, case):
        self.case,self.store,self.clock,self.calls,self.children,self.folders = case,Store(),[100.],[],[],[]
        self.identities={HELPER_PID:[HELPER_PID,101],MASTER_PID:[MASTER_PID,102]}
        self.socket=SimpleNamespace(st_mode=stat.S_IFSOCK|0o600,st_uid=os.getuid(),st_dev=11,st_ino=13)
        self.patches=[patch.object(auth,'process_identity',side_effect=lambda pid:self.identities.get(pid)),
                      patch.object(auth,'client_identity',return_value=copy.deepcopy(CAPABILITY['clientIdentity'])),
                      patch.object(auth.os,'killpg'),patch.object(auth.os,'lstat',return_value=self.socket)]
        self.mocks=[p.start() for p in self.patches]
        for p in self.patches:case.addCleanup(p.stop)
        self.manager=auth.SSHAuth(SimpleNamespace(store=self.store),describe_client=lambda p:copy.deepcopy(CAPABILITY),
                                  run=self.run,root_factory=self.folder,spawn=self.spawn,clock=lambda:self.clock[0],supervise=False)
        self.manager._pump=lambda s:None  # no real reader thread/process; tested separately with injected lines
        self.manager._start_writer=lambda s:None  # pure fixtures inspect the bounded queue
        case.addCleanup(self.manager.close)
        self.run_hook=None
    def folder(self):
        value=Folder();self.folders.append(value);return value
    def spawn(self,argv,**options):
        self.calls.append(('spawn',copy.deepcopy(argv),options));value=Helper();self.children.append(value);return value
    def run(self,argv,**options):
        self.calls.append(('run',list(argv),options))
        if self.run_hook:
            value=self.run_hook(argv,options)
            if value is not None:return value
        if '-O' in argv and argv[argv.index('-O')+1]=='check':
            return subprocess.CompletedProcess([],0,b'',('Master running (pid=%d)\r\n'%MASTER_PID).encode())
        match=re.fullmatch(r"printf '%s\\n' '([a-f0-9]{48})'; id -un",argv[-1])
        output=(match.group(1)+'\n'+PROFILE['username']+'\n').encode() if match else b'FIXTURE_RESULT\n'
        return subprocess.CompletedProcess([],0,output,b'')
    def plan(self):return self.manager.plan({'cluster_id':PROFILE['id'],'version':self.store.profile['version'],'owner':OWNER})
    def request(self,view,**extra):return {'session_id':view['sessionId'],'owner':OWNER,**extra}
    def started(self):
        view=self.plan();self.manager.start(self.request(view,request_id='fixture-start'))
        s=self.manager.sessions[view['sessionId']];s['masterIdentity']=self.identities[MASTER_PID]
        return view,s
    def verified(self,retain=True):
        view,s=self.started();result=self.manager.read(self.request(view,cursor=0));self.case.assertTrue(result['authenticated'])
        if retain:self.manager.finish(self.request(view,retain=True))
        return view,s


@unittest.skipUnless(os.name=='posix','Linux worker capability required')
class SSHAuthentication(unittest.TestCase):
    def test_master_manual_host_ask_and_slave_first_false_proxy_without_route_or_key_fallback(self):
        master=auth.master_args(PROFILE,'/private/s');self.assertIn('StrictHostKeyChecking=ask',master);self.assertIn('-J',master)
        self.assertEqual(master[master.index('-F')+1],'/dev/null');self.assertEqual(master.count('-F'),1);self.assertIn('SessionType=none',master)
        for control in (None,'check','forward','cancel'):
            slave=auth.slave_args(PROFILE,'/private/s',control)
            self.assertEqual(slave[:3],[PROFILE['ssh_client'],'-o','ProxyCommand=/bin/false'])
            self.assertIn('StrictHostKeyChecking=yes',slave);self.assertIn('BatchMode=yes',slave);self.assertIn('ControlMaster=no',slave)
            self.assertEqual(slave[slave.index('-F')+1],'/dev/null');self.assertNotIn('-J',slave);self.assertNotIn('-i',slave)
            self.assertNotIn('jump.example.invalid',slave);self.assertNotIn('StrictHostKeyChecking=ask',slave)
            self.assertEqual(slave[-5:],['-l',PROFILE['username'],'-p','2201',PROFILE['host']])

    def test_interactive_jump_literals_require_complete_user_host_and_port_at_every_boundary(self):
        good='fixture_jump@jump.example.invalid:2201'
        invalid=[['jump.example.invalid'],['fixture_jump@jump.example.invalid'],['jump.example.invalid:22'],
                 ['@jump.example.invalid:22'],['fixture_jump@jump.example.invalid:0'],['fixture_jump@jump.example.invalid:65536'],
                 ['fixture_jump@jump.example.invalid:-1'],['fixture_jump@jump.example.invalid:22x'],
                 ['fixture_jump@[not-an-ipv6]:22'],['fixture_jump@[2001:db8:::1]:22'],['fixture_jump@2001:db8::1:22'],
                 ['fixture_jump@-badhost:22'],['fixture_jump@bad host:22'],['-bad@jump.example.invalid:22'],
                 ['fixture_jump@jump.example.invalid:22,other'],[''],[None],[1],[[]],
                 [good]*9,good,(good,),None,{},False]
        calls=[]
        with patch.object(auth.os.path,'isfile',return_value=True),patch.object(auth.os,'access',return_value=True):
            for jumps in invalid:
                with self.subTest(jumps=jumps):
                    profile={**PROFILE,'proxy_jump':jumps}
                    with self.assertRaisesRegex(auth.AuthError,'interactive_jump_identity_required'):auth.reviewed_jumps(profile)
                    with self.assertRaisesRegex(auth.AuthError,'interactive_jump_identity_required'):auth.master_args(profile,'/private/s')
                    with self.assertRaisesRegex(auth.AuthError,'interactive_jump_identity_required'):auth.describe(profile,run=lambda *a,**k:calls.append(a))
        self.assertEqual(calls,[])
        f=AuthFixture(self);described=[];f.manager.describe_client=lambda p:described.append(p) or copy.deepcopy(CAPABILITY)
        for jumps in invalid:
            f.store.profile['proxy_jump']=jumps
            with self.subTest(stored_jumps=jumps):
                with self.assertRaisesRegex(auth.AuthError,'interactive_jump_identity_required'):f.plan()
        self.assertEqual(described,[]);self.assertEqual(f.manager.sessions,{});self.assertEqual(f.children,[])

    def test_complete_multihop_and_bracketed_ipv6_are_literal_reviewed_routes(self):
        for jumps in ([],['fixture_jump@jump.example.invalid:1'],['fixture_jump@192.0.2.1:65535'],
                      ['fixture_jump@[2001:db8::1]:2201'],['fixture_jump@jump.example.invalid:2222','fixture_v6@[::1]:2201']):
            with self.subTest(jumps=jumps):
                p={**PROFILE,'proxy_jump':jumps};self.assertEqual(auth.reviewed_jumps(p),jumps)
                argv=auth.master_args(p,'/private/s');self.assertEqual(argv[argv.index('-F')+1],'/dev/null')
                if jumps:self.assertEqual(argv[argv.index('-J')+1],','.join(jumps))
                else:self.assertNotIn('-J',argv)
                self.assertNotIn('-J',auth.slave_args(p,'/private/s'))

    def test_scope_excludes_mutable_health_but_covers_every_connection_identity_field(self):
        for key in ('connection_check','probe','updated_at'):
            self.assertEqual(auth.scope(PROFILE),auth.scope({**PROFILE,key:{'observed_at':999}}))
        for key,value in {'id':'other','version':2,'host':'other.example.invalid','username':'otheruser','target':'other@host',
                          'port':2202,'ssh_client':'/other/ssh','identity_file':'/other/key','proxy_jump':['otherjump'],
                          'via':['legacy-hop'],'auth_mode':'key'}.items():
            with self.subTest(field=key):self.assertNotEqual(auth.scope(PROFILE),auth.scope({**PROFILE,key:value}))

    def test_saved_profile_and_owner_are_checked_again_before_start(self):
        f=AuthFixture(self);view=f.plan();f.store.profile['host']='changed.example.invalid'
        with self.assertRaises(auth.AuthError):f.manager.start(f.request(view,request_id='start'))
        self.assertEqual(f.manager.sessions[view['sessionId']]['state'],'needs_human_auth')
        self.assertFalse(f.children);self.assertEqual(f.store.writes,[])
        with self.assertRaises(auth.AuthError):f.manager.read({**f.request(view),'owner':'b'*48})
        with self.assertRaises(auth.AuthError):f.manager.plan({'cluster_id':PROFILE['id'],'version':1,'owner':'invalid'})

    def test_version_request_is_strict_integer_not_boolean(self):
        f=AuthFixture(self)
        with self.assertRaises(auth.AuthError):f.manager.plan({'cluster_id':PROFILE['id'],'version':True,'owner':OWNER})

    def test_effective_client_change_prevents_spawn(self):
        f=AuthFixture(self);view=f.plan();f.manager.describe_client=lambda p:{**CAPABILITY,'digest':'changed'}
        result=f.manager.start(f.request(view,request_id='start'));self.assertEqual(result['reason'],'client_or_config_changed');self.assertFalse(f.children)

    def test_duplicate_start_is_one_owned_attempt_and_cancel_never_signals_foreign_pid(self):
        f=AuthFixture(self);view,s=f.started();again=f.manager.start(f.request(view,request_id='fixture-start'))
        self.assertEqual(again['status'],'awaiting_auth');self.assertEqual(len(f.children),1)
        f.identities[MASTER_PID]=[MASTER_PID,999]  # reused PID must not be signaled
        f.manager.finish(f.request(view,retain=False));self.assertEqual(f.children[0].terminations,1)
        f.mocks[2].assert_not_called();self.assertEqual(f.store.writes,[])

    def test_injected_positive_check_and_nonce_are_both_required_before_retained_batch_use(self):
        f=AuthFixture(self);view,s=f.verified();self.assertIs(f.manager.resolve(copy.deepcopy(PROFILE)),s)
        self.assertEqual(f.manager.execute(PROFILE,'fixture-readonly-command'),'FIXTURE_RESULT\n')
        calls=[x for x in f.calls if x[0]=='run'];self.assertGreaterEqual(len(calls),5)
        for _,argv,_ in calls:self.assertEqual(argv[1:3],['-o','ProxyCommand=/bin/false']);self.assertNotIn('-J',argv)
        self.assertEqual(s['output'],bytearray());self.assertEqual(f.store.writes,[])

    def test_repeated_health_probe_changes_do_not_invalidate_or_extend_verified_lease(self):
        f=AuthFixture(self);view,s=f.verified();when=s['verifiedClock']
        for observed in (123,456):
            f.store.profile['connection_check']={'observed_at':observed};f.store.profile['probe']={'observed_at':observed}
            f.clock[0]+=1;self.assertTrue(f.manager.read(f.request(view,cursor=0))['authenticated'])
            self.assertIs(f.manager.resolve(PROFILE),s);f.manager.finish(f.request(view,retain=True));self.assertEqual(s['verifiedClock'],when)

    def test_retained_old_snapshot_never_resolves_to_current_profile_version(self):
        f=AuthFixture(self);view,old=f.verified();snapshot=copy.deepcopy(PROFILE)
        f.store.profile.update(version=2,host='new.example.invalid')
        self.assertIs(f.manager.resolve(snapshot),old)
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(f.store.profile)
        # A new-version auth does not satisfy an old run after its old lease is gone.
        f.manager.finish(f.request(view,retain=False));newview,new=f.verified()
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(snapshot)
        self.assertIs(f.manager.resolve(f.store.profile),new)

    def test_retained_lease_expiry_closes_owned_session_and_never_falls_back(self):
        f=AuthFixture(self);view,s=f.verified();f.clock[0]+=auth.LEASE_SECONDS+1
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.execute(PROFILE,'fixture-readonly-command')
        self.assertEqual(s['reason'],'auth_expired');self.assertEqual(len(f.children),1)

    def test_idle_incomplete_authentication_expires_without_persisting_private_output(self):
        f=AuthFixture(self);view,s=f.started();s['output'].extend(b'SYNTHETIC_PRIVATE_OUTPUT');f.clock[0]+=auth.IDLE_SECONDS+1
        status=f.manager.read(f.request(view,cursor=0));self.assertEqual(status['reason'],'auth_expired');self.assertEqual(status['privateOutput'],'')
        self.assertNotIn('SYNTHETIC',json.dumps(status));self.assertEqual(f.store.writes,[])

    def test_private_input_is_bounded_sequenced_and_resize_rejects_bool(self):
        f=AuthFixture(self);view,s=f.started();secret='SYNTHETIC_PRIVATE_INPUT'
        result=f.manager.input(f.request(view,data=secret,sequence=1));self.assertEqual(result,{'accepted':True})
        self.assertIn(secret,b''.join(s['wire']).decode());self.assertNotIn(secret,json.dumps(f.manager.public(s)))
        for data in ({'data':'x','sequence':1},{'data':'x'*4097,'sequence':2},{'data':'x','sequence':True}):
            with self.assertRaises(auth.AuthError):f.manager.input(f.request(view,**data))
        with self.assertRaises(auth.AuthError):f.manager.resize(f.request(view,rows=True,cols=80))
        self.assertEqual(f.manager.resize(f.request(view,rows=40,cols=100)),{'accepted':True})

    def test_closed_owned_session_rejects_private_input_without_secret_in_public_error(self):
        f=AuthFixture(self);view,s=f.started();f.manager.finish(f.request(view,retain=False))
        private_input='SYNTHETIC_PRIVATE_INPUT'
        try:f.manager.input(f.request(view,data=private_input,sequence=1))
        except auth.AuthError as error:
            rendered=''.join(traceback.format_exception(error));self.assertNotIn('SYNTHETIC',rendered);self.assertEqual(str(error),'private_input_out_of_scope')
        else:self.fail('Closed owned pipe must fail')
        self.assertEqual(s['state'],'closed')

    def test_injected_master_death_between_check_and_nonce_fails_closed(self):
        f=AuthFixture(self);view,s=f.started()
        def death(argv,options):
            if '-O' not in argv:
                f.identities.pop(MASTER_PID,None)
                return subprocess.CompletedProcess([],255,b'',b'SYNTHETIC_PRIVATE_NETWORK_DETAIL')
        f.run_hook=death;result=f.manager.read(f.request(view,cursor=0));self.assertFalse(result['authenticated']);self.assertEqual(result['status'],'needs_human_auth')
        calls=[x for x in f.calls if x[0]=='run'];self.assertEqual(len(calls),2)
        self.assertTrue(all(x[1][1:3]==['-o','ProxyCommand=/bin/false'] for x in calls));self.assertNotIn('SYNTHETIC',json.dumps(result))

    def test_nonce_username_or_master_pid_mismatch_cannot_publish_authenticated(self):
        for case in ('nonce','username','master-pid','master-pid-prefix'):
            with self.subTest(case=case):
                f=AuthFixture(self);view,s=f.started()
                def invalid(argv,options):
                    if '-O' in argv and case=='master-pid':return subprocess.CompletedProcess([],0,b'',b'Master running (pid=123)')
                    if '-O' in argv and case=='master-pid-prefix':return subprocess.CompletedProcess([],0,b'',('Master running (pid=%d0)'%MASTER_PID).encode())
                    if '-O' not in argv:
                        nonce=re.search(r"'([a-f0-9]{48})'",argv[-1]).group(1)
                        return subprocess.CompletedProcess([],0,((nonce if case!='nonce' else 'wrong')+'\n'+('wrong' if case=='username' else PROFILE['username'])+'\n').encode(),b'')
                f.run_hook=invalid;result=f.manager.read(f.request(view,cursor=0));self.assertFalse(result['authenticated']);self.assertEqual(result['status'],'needs_human_auth')

    def test_changed_source_during_injected_nonce_cannot_publish_a_late_verified_receipt(self):
        f=AuthFixture(self);view,s=f.started()
        def change(argv,options):
            if '-O' not in argv:f.store.profile['version']=2
        f.run_hook=change;result=f.manager.read(f.request(view,cursor=0));self.assertFalse(result['authenticated']);self.assertEqual(result['status'],'needs_human_auth')

    def test_scoped_private_output_ring_is_bounded_and_retained_output_is_discarded(self):
        for retained in (False,True):
            with self.subTest(retained=retained):
                f=AuthFixture(self);view,s=f.started();s['retained']=retained
                lines=[(json.dumps({'type':'output','base64':base64.b64encode(b'x'*12288).decode()})+'\n').encode() for _ in range(8)]
                captured={}
                class Stream:
                    closed=False
                    def readline(self,n):
                        if lines:return lines.pop(0)
                        captured.update(size=len(s['output']),offset=s['offset']);return b''
                    def close(self):self.closed=True
                f.children[0].stdout=Stream();auth.SSHAuth._pump(f.manager,s)
                self.assertEqual(captured['size'],0 if retained else auth.PRIVATE_LIMIT)
                self.assertEqual(captured['offset'],0 if retained else 8*12288-auth.PRIVATE_LIMIT)
                self.assertFalse(s['output']);self.assertEqual(s['state'],'needs_human_auth')
                self.assertGreaterEqual(f.children[0].waits,1);self.assertTrue(f.children[0].stdin.closed);self.assertTrue(f.children[0].stdout.closed)

    def test_private_reader_reaps_helper_and_timeout_kill_requires_exact_owned_identity(self):
        for owned in (True,False):
            with self.subTest(owned=owned):
                f=AuthFixture(self);view,s=f.started();child=f.children[0];child.wait_timeouts=1
                if not owned:f.identities[HELPER_PID]=[HELPER_PID,999]
                auth.SSHAuth._pump(f.manager,s)
                self.assertEqual(child.kills,1 if owned else 0);self.assertEqual(child.waits,2 if owned else 1)
                self.assertTrue(child.stdin.closed);self.assertTrue(child.stdout.closed)

    def test_missing_or_replaced_socket_identity_and_worker_identity_cannot_resolve(self):
        f=AuthFixture(self);view,s=f.verified();f.socket.st_ino+=1
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(PROFILE)
        g=AuthFixture(self);v,s=g.verified();g.manager.worker_identity='new-worker-instance'
        with self.assertRaises(auth.AuthError):g.manager.read(g.request(v,cursor=0))

    def test_effective_option_probe_is_injected_and_rejects_missing_safety_controls(self):
        values={'controlmaster':'true','controlpersist':'no','forkafterauthentication':'no','stricthostkeychecking':'ask',
                'forwardagent':'no','clearallforwardings':'yes','permitlocalcommand':'no','remotecommand':'none','sessiontype':'none',
                'controlpath':'/__studio_capability_socket__','hostname':PROFILE['host'],'user':PROFILE['username'],'port':'2201',
                'proxyjump':','.join(PROFILE['proxy_jump'])}
        calls=[]
        def run(argv,**options):
            calls.append(argv);return subprocess.CompletedProcess([],0,('\n'.join(k+' '+v for k,v in values.items())+'\n').encode(),b'')
        with patch.object(auth.os.path,'isfile',return_value=True),patch.object(auth.os,'access',return_value=True),patch.object(auth,'client_identity',return_value=CAPABILITY['clientIdentity']):
            self.assertIn('digest',auth.describe(PROFILE,run=run));self.assertIn('-G',calls[0]);self.assertEqual(calls[0][calls[0].index('-F')+1],'/dev/null')
            values.pop('remotecommand');self.assertIn('digest',auth.describe(PROFILE,run=run))
            values['remotecommand']='arbitrary-command'
            with self.assertRaisesRegex(auth.AuthError,'options_unsupported'):auth.describe(PROFILE,run=run)
            values['remotecommand']='none'
            for key in ('stricthostkeychecking','controlmaster','controlpath','forkafterauthentication','sessiontype'):
                original=values.pop(key)
                with self.assertRaisesRegex(auth.AuthError,'options_unsupported'):auth.describe(PROFILE,run=run)
                values[key]=original
            for wrong in ('none','fixture_jump@other.example.invalid:2201'):
                values['proxyjump']=wrong
                with self.assertRaisesRegex(auth.AuthError,'options_unsupported'):auth.describe(PROFILE,run=run)
            values.pop('proxyjump')
            with self.assertRaisesRegex(auth.AuthError,'options_unsupported'):auth.describe(PROFILE,run=run)
            self.assertIn('digest',auth.describe({**PROFILE,'proxy_jump':[]},run=run))
            values['proxyjump']=','.join(PROFILE['proxy_jump'])
            values['proxycommand']='SYNTHETIC_PRIVATE_CONFIG'
            with self.assertRaisesRegex(auth.AuthError,'config_proxy_unsupported'):auth.describe(PROFILE,run=run)
        for update in ({'ssh_client':'/mnt/c/ssh.exe'},{'identity_file':'/mnt/c/key'},{'via':['legacy']}):
            with self.assertRaises(auth.AuthError):auth.describe({**PROFILE,**update},run=lambda *a,**k:self.fail('No client command allowed'))

    def _owned_pipe(self,f,s,fill=True):
        read,write=os.pipe();os.set_blocking(read,False);os.set_blocking(write,False)
        filled=0
        if fill:
            while True:
                try:filled+=os.write(write,b'p'*4096)
                except BlockingIOError:break
            self.assertGreater(filled,0)
        f.children[0].stdin.close();f.children[0].stdin=os.fdopen(write,'wb',buffering=0)
        f.pipe_reader=os.fdopen(read,'rb',buffering=0)
        duplicates=[];real_dup=os.dup
        def duplicate(fd):
            value=real_dup(fd);duplicates.append(value);return value
        with patch.object(auth.os,'dup',side_effect=duplicate):auth.SSHAuth._start_writer(f.manager,s)
        def cleanup():
            f.manager.close()
            if not f.pipe_reader.closed:f.pipe_reader.close()
        self.addCleanup(cleanup)
        return read,filled,duplicates

    def _fast(self,operation,read):
        results=[];errors=[]
        def call():
            try:results.append(operation())
            except Exception as error:errors.append(error)
        thread=threading.Thread(target=call,daemon=True);thread.start();thread.join(.5)
        if thread.is_alive():
            # Recover the owned fixture before reporting a blocked lifecycle call.
            try:
                while os.read(read,65536):pass
            except BlockingIOError:pass
            thread.join(1)
            self.fail('Private pipe backpressure blocked a lifecycle operation')
        if errors:raise errors[0]
        return results[0]

    def _assert_writer_stopped(self,s,duplicates):
        s['writerThread'].join(.5);self.assertFalse(s['writerThread'].is_alive())
        self.assertTrue(s['wireStop'].is_set());self.assertFalse(s['wire']);self.assertEqual(s['wireBytes'],0)
        for descriptor in duplicates:
            with self.assertRaises(OSError):os.fstat(descriptor)

    def test_full_owned_pipe_input_and_cancel_complete_without_draining_or_replaying_private_bytes(self):
        f=AuthFixture(self);view,s=f.started();read,filled,duplicates=self._owned_pipe(f,s)
        private_input='SYNTHETIC_PRIVATE_FULL_PIPE'
        self.assertEqual(self._fast(lambda:f.manager.input(f.request(view,data=private_input,sequence=1)),read),{'accepted':True})
        before=len(s['wire'])
        with self.assertRaises(auth.AuthError):f.manager.input(f.request(view,data=private_input,sequence=1))
        self.assertEqual(len(s['wire']),before)
        self.assertTrue(f.manager.lock.acquire(timeout=.1));f.manager.lock.release()
        result=self._fast(lambda:f.manager.finish(f.request(view,retain=False)),read)
        self.assertEqual(result['status'],'closed');self._assert_writer_stopped(s,duplicates)
        data=bytearray()
        while True:
            block=os.read(read,65536)
            if not block:break
            data.extend(block)
        self.assertEqual(data,b'p'*filled);self.assertNotIn(private_input,json.dumps(result))

    def test_full_owned_pipe_does_not_block_idle_expiry_or_leave_queued_private_bytes(self):
        f=AuthFixture(self);view,s=f.started();read,filled,duplicates=self._owned_pipe(f,s)
        self._fast(lambda:f.manager.input(f.request(view,data='SYNTHETIC_PRIVATE_EXPIRE',sequence=1)),read)
        f.clock[0]+=auth.IDLE_SECONDS+1
        def expire():
            with f.manager.lock:f.manager._expire()
        self._fast(expire,read);self.assertEqual(s['reason'],'auth_expired');self._assert_writer_stopped(s,duplicates)
        data=bytearray()
        while True:
            block=os.read(read,65536)
            if not block:break
            data.extend(block)
        self.assertEqual(data,b'p'*filled)

    def test_broken_owned_pipe_fails_asynchronously_without_private_error_or_retry(self):
        f=AuthFixture(self);view,s=f.started();read,filled,duplicates=self._owned_pipe(f,s,fill=False)
        f.pipe_reader.close()
        try:f.manager.input(f.request(view,data='SYNTHETIC_PRIVATE_BROKEN_PIPE',sequence=1))
        except auth.AuthError:pass
        until=time.monotonic()+.5
        while s['state']=='awaiting_auth' and time.monotonic()<until:time.sleep(.01)
        self.assertEqual(s['state'],'needs_human_auth');self.assertEqual(s['reason'],'auth_process_exited')
        self._assert_writer_stopped(s,duplicates);self.assertNotIn('SYNTHETIC',json.dumps(f.manager.public(s)))

    def test_input_queue_and_encoded_packet_bounds_never_resend_a_sequence(self):
        f=AuthFixture(self);view,s=f.started();accepted=0
        for sequence in range(1,10):
            try:f.manager.input(f.request(view,data='x'*4096,sequence=sequence));accepted+=1
            except auth.AuthError:break
        self.assertGreater(accepted,0);self.assertLessEqual(len(s['wire']),8);self.assertLessEqual(s['wireBytes'],65536)
        snapshot=list(s['wire'])
        with self.assertRaises(auth.AuthError):f.manager.input(f.request(view,data='x'*4096,sequence=sequence))
        self.assertEqual(list(s['wire']),snapshot)
        g=AuthFixture(self);other,session=g.started();before=list(session['wire'])
        with self.assertRaisesRegex(auth.AuthError,'private_input_backpressure'):g.manager.input(g.request(other,data='\0'*1500,sequence=1))
        self.assertEqual(list(session['wire']),before)

    def test_retain_wipes_pending_private_wire_without_closing_the_verified_master_input(self):
        f=AuthFixture(self);view,s=f.started();f.manager.input(f.request(view,data='SYNTHETIC_PRIVATE_QUEUED',sequence=1))
        self.assertTrue(s['wire']);self.assertTrue(f.manager.read(f.request(view,cursor=0))['authenticated'])
        result=f.manager.finish(f.request(view,retain=True));self.assertTrue(result['authenticated'])
        self.assertTrue(s['wireStop'].is_set());self.assertFalse(s['wire']);self.assertEqual(s['wireBytes'],0)
        self.assertFalse(f.children[0].stdin.closed);self.assertEqual(f.children[0].stdin.values,[])
        with self.assertRaises(auth.AuthError):f.manager.input(f.request(view,data='x',sequence=2))
        self.assertIs(f.manager.resolve(PROFILE),s)

    def test_remote_command_rc2_retains_live_lease_and_next_authorized_operation_can_succeed(self):
        f=AuthFixture(self);view,s=f.verified()
        f.run_hook=lambda argv,options:subprocess.CompletedProcess([],2,b'',b'SYNTHETIC_PRIVATE_REMOTE_ERROR')
        with self.assertRaisesRegex(auth.RemoteOperationError,'remote_operation_failed'):f.manager.execute(PROFILE,'fixture-remote-operation')
        self.assertEqual(s['state'],'verified');self.assertIs(f.manager.resolve(PROFILE),s);self.assertEqual(f.children[0].terminations,0)
        f.run_hook=None;self.assertEqual(f.manager.execute(PROFILE,'next-reviewed-operation'),'FIXTURE_RESULT\n');self.assertEqual(len(f.children),1)

    def test_remote_rc255_is_unknown_delivery_without_lease_destruction_or_automatic_replay(self):
        f=AuthFixture(self);view,s=f.verified();before=len(f.calls)
        f.run_hook=lambda argv,options:subprocess.CompletedProcess([],255,b'',b'SYNTHETIC_PRIVATE_TRANSPORT_ERROR')
        with self.assertRaisesRegex(auth.RemoteOperationError,'remote_transport_unconfirmed'):f.manager.execute(PROFILE,'fixture-remote-operation')
        self.assertEqual(len(f.calls),before+1);self.assertEqual(s['state'],'verified');self.assertEqual(f.children[0].terminations,0)

    def test_timeout_or_output_limit_with_live_master_retains_authentication_without_retry(self):
        for kind in ('timeout','output-limit'):
            with self.subTest(kind=kind):
                f=AuthFixture(self);view,s=f.verified();before=len(f.calls)
                def failed(argv,options):
                    if kind=='timeout':raise subprocess.TimeoutExpired(['fixture-command'],1,output=b'SYNTHETIC_PRIVATE_OUTPUT')
                    raise auth.AuthError('ssh_output_limit')
                f.run_hook=failed
                with self.assertRaisesRegex(auth.RemoteOperationError,'remote_operation_unconfirmed'):f.manager.execute(PROFILE,'fixture-remote-operation')
                self.assertEqual(len(f.calls),before+1);self.assertEqual(s['state'],'verified');self.assertIs(f.manager.resolve(PROFILE),s)
                f.run_hook=None;self.assertEqual(f.manager.execute(PROFILE,'next-reviewed-operation'),'FIXTURE_RESULT\n')

    def test_proven_master_loss_during_batch_still_invalidates_lease_without_replay(self):
        f=AuthFixture(self);view,s=f.verified();before=len(f.calls)
        def died(argv,options):f.identities.pop(MASTER_PID,None);return subprocess.CompletedProcess([],255,b'',b'')
        f.run_hook=died
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.execute(PROFILE,'fixture-remote-operation')
        self.assertEqual(s['state'],'needs_human_auth');self.assertEqual(len(f.calls),before+1);self.assertEqual(len(f.children),1)

    @unittest.skipUnless(os.environ.get('STUDIO_TEST_SSH_G')=='1','Opt-in null/generated config -G capability proof')
    def test_installed_null_config_and_explicit_jump_parse_without_match_exec_or_connections(self):
        client='/usr/bin/ssh'
        if not os.path.isfile(client):self.skipTest('Authorized installed Linux SSH client unavailable')
        runtime=Path(__file__).resolve().parents[2]/'.studio/v0189/button-audit/c/compute-connection-hil/phase2/core/repair2'
        runtime.mkdir(parents=True,exist_ok=True);receipts=[]
        with tempfile.TemporaryDirectory(prefix='null-config-',dir=runtime) as folder:
            folder=Path(folder);marker=folder/'match-exec-marker';config=folder/'generated_config'
            config.write_text('Host *\n HostName alternate-route.example.invalid\nMatch exec "/usr/bin/touch '+str(marker)+'"\n',encoding='utf8')
            for jumps in ([],['fixture_jump@jump.example.invalid:2222'],
                          ['fixture_jump@jump.example.invalid:2222','fixture_second@second.example.invalid:2201'],
                          ['fixture_jump@jump.example.invalid:2222','fixture_v6@[2001:db8::1]:2201']):
                profile={**PROFILE,'ssh_client':client,'identity_file':'','host':'reviewed-alias.example.invalid','proxy_jump':jumps}
                def run(argv,**options):
                    self.assertIn('-G',argv)
                    # Model an ambient fixture config only when production failed
                    # to pin a config. Fixed -F /dev/null must prevent reading it.
                    actual=argv if '-F' in argv else [argv[0],'-F',str(config),*argv[1:]]
                    result=auth.bounded_run(actual,**options)
                    allowed={'hostname','user','port','proxyjump','controlmaster','controlpersist','controlpath',
                             'forkafterauthentication','stricthostkeychecking','forwardagent','clearallforwardings',
                             'permitlocalcommand','sessiontype','remotecommand'}
                    values={}
                    for line in result.stdout.decode('utf8','replace').splitlines():
                        key,_,value=line.partition(' ')
                        if key in allowed:values.setdefault(key,[]).append(value)
                    receipts.append({'nullConfig':actual.count('-F')==1 and actual[actual.index('-F')+1]=='/dev/null',
                                     'explicitJump':jumps,'effective':values,'returncode':result.returncode})
                    self.assertFalse(marker.exists(),'Null config must prevent ambient Match exec')
                    self.assertEqual(actual[actual.index('-F')+1],'/dev/null')
                    return result
                result=auth.describe(profile,run=run);self.assertIn('digest',result)
                self.assertEqual(result['proxyJump'],','.join(jumps) if jumps else 'none')
            self.assertFalse(marker.exists())
        (runtime/'installed-null-config-capability.json').write_text(json.dumps(receipts,indent=2)+'\n',encoding='utf8')


@unittest.skipUnless(os.name=='posix','Linux worker capability required')
class OriginalRunAuthentication(unittest.TestCase):
    def original(self,mode='interactive'):
        from studio_worker.cluster import Clusters
        f=AuthFixture(self);snapshot=copy.deepcopy(PROFILE)
        if mode=='key':snapshot.update(auth_mode='key',ssh_client='/mnt/c/Windows/System32/OpenSSH/ssh.exe',identity_file='/mnt/c/fixture-key-reference',proxy_jump=['existing-alias'],via=['legacy-inner'])
        run={'id':'original-run','kind':'cluster-run','name':'Original submitted fixture','project_id':'original-project',
             'cluster_id':snapshot['id'],'nonce':'c'*32,'cluster_snapshot':snapshot,'status':'queued','job_id':'123',
             'submit_attempted':True,'updated_at':1}
        f.store.runs[run['id']]=run;f.store.projects[run['project_id']]={'id':run['project_id'],'policy':{'clusters':[snapshot['id']]}}
        controller=object.__new__(Clusters);controller.store=f.store;f.manager.service.clusters=controller
        f.key_hook=None
        def transport(p):
            captured=copy.deepcopy(p)
            def run(script,data=None,timeout=40):
                f.calls.append(('key-check',captured,script,timeout))
                if f.key_hook:return f.key_hook(captured,script,timeout)
                return captured['username']+'\n'
            return SimpleNamespace(run=run,original_key_identity=lambda:run('id -un',timeout=25))
        controller.transport=transport
        f.original_profile=copy.deepcopy(snapshot);f.original_run=run
        f.store.profile=copy.deepcopy(snapshot);f.store.profile.update(version=2,host='latest.example.invalid',target='otheruser@latest.example.invalid',username='otheruser')
        return f

    def plan(self,f,owner=OWNER):return f.manager.plan({'run_id':'original-run','owner':owner})
    def started(self,f):
        view=self.plan(f);f.manager.start(f.request(view,request_id='original-start'));s=f.manager.sessions[view['sessionId']]
        if s['authMode']=='interactive':s['masterIdentity']=f.identities[MASTER_PID]
        return view,s
    def verified(self,f):
        view,s=self.started(f);self.assertTrue(f.manager.read(f.request(view,cursor=0))['authenticated']);f.manager.finish(f.request(view,retain=True));return view,s

    def test_original_plan_uses_raw_v1_snapshot_not_latest_v2_or_poll_and_returns_private_receipt(self):
        f=self.original();view=self.plan(f);s=f.manager.sessions[view['sessionId']]
        self.assertEqual(s['profile'],f.original_profile);self.assertEqual(view['version'],1);self.assertEqual(view['origin']['kind'],'original-run')
        self.assertEqual(view['origin']['runId'],'original-run');self.assertEqual(view['origin']['projectId'],'original-project')
        self.assertEqual(view['authMode'],'interactive');self.assertFalse(view['newForwardAllowed']);self.assertFalse(view['authenticated'])
        self.assertEqual(view['sourceReceipt']['nonce'],'c'*32);self.assertEqual(len(view['sourceReceipt']['snapshotDigest']),64)
        self.assertNotIn('nonce',view['origin']);self.assertNotIn('host',view['origin']);self.assertFalse(f.calls);self.assertEqual(f.store.writes,[])
        current=f.plan();self.assertEqual(current['origin']['kind'],'saved-profile');self.assertTrue(current['newForwardAllowed']);self.assertNotIn('sourceReceipt',current)

    def test_original_plan_rejects_mixed_overrides_and_raw_identity_mismatch_before_client(self):
        f=self.original();called=[];f.manager.describe_client=lambda p:called.append(p) or CAPABILITY
        for data in ({'run_id':'original-run','owner':OWNER,'cluster_id':PROFILE['id']},
                     {'run_id':'original-run','owner':OWNER,'version':1},{'run_id':'original-run','owner':OWNER,'profile':PROFILE},
                     {'run_id':[],'owner':OWNER}):
            with self.assertRaises(auth.AuthError):f.manager.plan(data)
        original=copy.deepcopy(f.original_run)
        for mutate in (lambda r:r.update(kind='run'),lambda r:r.pop('nonce'),lambda r:r.update(cluster_id='other'),
                       lambda r:r['cluster_snapshot'].update(version=True)):
            f.store.runs['original-run']=copy.deepcopy(original);mutate(f.store.runs['original-run'])
            with self.assertRaisesRegex(auth.AuthError,'original_run_(unavailable|policy_blocked)'):self.plan(f)
        self.assertEqual(called,[]);self.assertEqual(f.manager.sessions,{})

    def test_expired_old_lease_can_authenticate_exact_original_v1_after_saving_v2(self):
        f=self.original();latest=copy.deepcopy(f.store.profile);f.store.profile=copy.deepcopy(PROFILE)
        oldview,old=f.verified();f.store.profile=latest;f.clock[0]+=auth.LEASE_SECONDS+1;f.manager._expire();self.assertEqual(old['reason'],'auth_expired')
        view,s=self.verified(f);self.assertEqual(s['profile']['version'],1);receipt=copy.deepcopy(view['sourceReceipt'])
        for result in (f.manager.read(f.request(view,cursor=0)),f.manager.finish(f.request(view,retain=True))):self.assertEqual(result['sourceReceipt'],receipt);self.assertTrue(result['authenticated'])
        f.store.profile.update(version=3,host='third.example.invalid');f.manager._supervise_once();self.assertEqual(s['state'],'verified')
        self.assertIs(f.manager.resolve(f.original_profile),s)
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(f.store.profile)
        self.assertEqual(f.manager.execute(f.original_profile,'fixture-monitor-original'),'FIXTURE_RESULT\n')

    def test_mutable_original_run_status_job_and_observations_do_not_invalidate_immutable_source(self):
        f=self.original();view,s=self.verified(f);receipt=copy.deepcopy(view['sourceReceipt'])
        f.original_run.update(status='unknown',job_id=None,updated_at=999,last_observed=99,scheduler_state='unknown',submit_attempted=True)
        result=f.manager.read(f.request(view,cursor=0));self.assertTrue(result['authenticated']);self.assertEqual(result['sourceReceipt'],receipt)
        f.manager._supervise_once();self.assertEqual(s['state'],'verified');self.assertIs(f.manager.resolve(f.original_profile),s)

    def test_original_plan_can_reuse_only_the_exact_retained_connection_without_new_master(self):
        f=self.original();latest=copy.deepcopy(f.store.profile);f.store.profile=copy.deepcopy(PROFILE)
        previous,s=f.verified();f.store.profile=latest;before=len(f.children);view=self.plan(f)
        self.assertEqual(view['sessionId'],previous['sessionId']);self.assertEqual(len(f.children),before)
        self.assertEqual(view['origin']['kind'],'original-run');self.assertFalse(view['newForwardAllowed']);self.assertIs(f.manager.resolve(f.original_profile),s)
        f.original_run['nonce']='d'*32;f.manager._supervise_once();self.assertEqual(s['reason'],'original_run_changed')

    def test_a_verified_latest_v2_lease_cannot_serve_the_v1_original_run(self):
        f=self.original()
        def explicit_user(argv,options):
            if '-O' in argv:return
            match=re.fullmatch(r"printf '%s\\n' '([a-f0-9]{48})'; id -un",argv[-1])
            if match:return subprocess.CompletedProcess([],0,(match.group(1)+'\n'+argv[argv.index('-l')+1]+'\n').encode(),b'')
        f.run_hook=explicit_user;current,s=f.verified()
        self.assertEqual(s['profile']['version'],2);self.assertIs(f.manager.resolve(f.store.profile),s)
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(f.original_profile)
        original,old=self.verified(f);self.assertNotEqual(original['sessionId'],current['sessionId']);self.assertEqual(old['profile']['version'],1)

    def test_original_source_loss_during_monitor_transport_cannot_publish_a_late_success(self):
        f=self.original();view,s=self.verified(f);before=len([x for x in f.calls if x[0]=='run'])
        def changed(argv,options):f.original_run['nonce']='d'*32;return subprocess.CompletedProcess([],0,b'late fixture success',b'')
        f.run_hook=changed
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.execute(f.original_profile,'fixture-monitor-original')
        self.assertEqual(s['reason'],'original_run_changed');self.assertEqual(len([x for x in f.calls if x[0]=='run']),before+1)

    def test_nonce_or_snapshot_change_during_verification_discards_late_verified_result(self):
        for change in ('nonce','snapshot','policy','deletion'):
            with self.subTest(change=change):
                f=self.original();view,s=self.started(f);receipt=copy.deepcopy(view['sourceReceipt'])
                def mutate(argv,options):
                    if '-O' in argv:return
                    if change=='nonce':f.original_run['nonce']='d'*32
                    elif change=='snapshot':f.original_run['cluster_snapshot']['port']=2202
                    elif change=='policy':f.store.projects['original-project']['policy']['clusters']=[]
                    else:f.store.runs.pop('original-run')
                f.run_hook=mutate;result=f.manager.read(f.request(view,cursor=0));self.assertFalse(result['authenticated']);self.assertEqual(result['status'],'needs_human_auth');self.assertEqual(result['sourceReceipt'],receipt)
                closed=f.manager.finish(f.request(view,retain=False));self.assertEqual(closed['sourceReceipt'],receipt);self.assertFalse(closed['authenticated'])

    def test_retained_original_run_is_rechecked_on_policy_nonce_snapshot_and_deletion(self):
        for change in ('nonce','snapshot','project','policy','deletion'):
            with self.subTest(change=change):
                f=self.original();view,s=self.verified(f);receipt=copy.deepcopy(view['sourceReceipt'])
                if change=='nonce':f.original_run['nonce']='d'*32
                elif change=='snapshot':f.original_run['cluster_snapshot']['identity_file']='/other/key-reference'
                elif change=='project':f.original_run['project_id']='other-project'
                elif change=='policy':f.store.projects['original-project']['policy']['clusters']=[]
                else:f.store.runs.pop('original-run')
                f.manager._supervise_once();self.assertEqual(s['state'],'needs_human_auth')
                with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(f.original_profile)
                result=f.manager.read(f.request(view,cursor=0));self.assertEqual(result['sourceReceipt'],receipt)
                self.assertEqual(f.manager.finish(f.request(view,retain=False))['sourceReceipt'],receipt)

    def test_original_source_change_after_capability_check_cannot_publish_plan_or_start_helper(self):
        f=self.original();calls=[]
        def changed(p):calls.append(p);f.original_run['nonce']='d'*32;return copy.deepcopy(CAPABILITY)
        f.manager.describe_client=changed
        with self.assertRaisesRegex(auth.AuthError,'original_run_changed'):self.plan(f)
        self.assertEqual(f.children,[]);self.assertEqual(f.manager.sessions,{})
        g=self.original();view=self.plan(g)
        def changed_at_start(p):g.original_run['nonce']='d'*32;return copy.deepcopy(CAPABILITY)
        g.manager.describe_client=changed_at_start;result=g.manager.start(g.request(view,request_id='start'))
        self.assertEqual(result['reason'],'original_run_changed');self.assertEqual(g.children,[])

    def test_key_original_route_preserves_windows_via_reference_and_never_creates_mux_lease(self):
        f=self.original('key');f.manager.describe_client=lambda p:self.fail('Key route must not invoke controlled-client probe')
        view=self.plan(f);self.assertEqual(view['authMode'],'key');self.assertEqual(view['status'],'review');self.assertFalse(view['newForwardAllowed'])
        result=f.manager.start(f.request(view,request_id='key-check'));self.assertEqual(result['status'],'key_verified');self.assertEqual(result['keyCheckStatus'],'passed');self.assertFalse(result['authenticated'])
        self.assertEqual(result['sourceReceipt'],view['sourceReceipt']);self.assertEqual(f.children,[])
        checked=[x for x in f.calls if x[0]=='key-check'];self.assertEqual(len(checked),1);self.assertEqual(checked[0][1],f.original_profile);self.assertEqual(checked[0][2:],('id -un',25))
        with self.assertRaisesRegex(auth.AuthError,'needs_human_auth'):f.manager.resolve(f.original_profile)
        closed=f.manager.finish(f.request(view,retain=True));self.assertEqual(closed['status'],'closed');self.assertFalse(closed['authenticated']);self.assertFalse(f.manager.sessions[view['sessionId']]['retained'])

    def test_key_check_runs_outside_lock_can_cancel_and_never_publishes_late_success(self):
        f=self.original('key');view=self.plan(f);entered=threading.Event();release=threading.Event();results=[]
        def wait(p,script,timeout):
            self.assertFalse(f.manager.lock._is_owned());entered.set();release.wait(2);return p['username']+'\n'
        f.key_hook=wait;operation=threading.Thread(target=lambda:results.append(f.manager.start(f.request(view,request_id='key-check'))));operation.start()
        try:
            self.assertTrue(entered.wait(1));duplicate=f.manager.start(f.request(view,request_id='key-check'));self.assertEqual(duplicate['status'],'checking_key')
            closed=f.manager.finish(f.request(view,retain=False));self.assertEqual(closed['status'],'closed');self.assertEqual(len([x for x in f.calls if x[0]=='key-check']),1)
        finally:release.set();operation.join(2)
        self.assertFalse(operation.is_alive());self.assertEqual(results[0]['status'],'closed');self.assertFalse(results[0]['authenticated'])

    def test_key_check_source_or_policy_changes_discard_results_but_latest_profile_change_does_not(self):
        for change in ('nonce','policy','deletion','latest'):
            with self.subTest(change=change):
                f=self.original('key');view=self.plan(f)
                def check(p,script,timeout):
                    if change=='nonce':f.original_run['nonce']='d'*32
                    elif change=='policy':f.store.projects['original-project']['policy']['clusters']=[]
                    elif change=='deletion':f.store.runs.pop('original-run')
                    else:f.store.profile.update(version=3,host='third.example.invalid')
                    return p['username']+'\n'
                f.key_hook=check;result=f.manager.start(f.request(view,request_id='key-check'))
                self.assertEqual(result['status'],'key_verified' if change=='latest' else 'needs_human_auth');self.assertFalse(result['authenticated']);self.assertEqual(result['sourceReceipt'],view['sourceReceipt'])

    def test_key_check_expiry_discards_late_success_without_creating_a_lease(self):
        f=self.original('key');view=self.plan(f)
        def elapsed(p,script,timeout):f.clock[0]+=auth.IDLE_SECONDS+1;return p['username']+'\n'
        f.key_hook=elapsed;result=f.manager.start(f.request(view,request_id='key-check'))
        self.assertEqual(result['reason'],'auth_expired');self.assertFalse(result['authenticated']);self.assertEqual(f.children,[])

    def test_key_check_failures_are_bounded_sanitized_and_cannot_write_private_input(self):
        for output in ('otheruser\n','x'*8193):
            f=self.original('key');view=self.plan(f);f.key_hook=lambda *args:output
            result=f.manager.start(f.request(view,request_id='key-check'));self.assertEqual(result['reason'],'key_check_failed');self.assertEqual(result['keyCheckStatus'],'failed');self.assertFalse(result['authenticated'])
            with self.assertRaises(auth.AuthError):f.manager.input(f.request(view,data='SYNTHETIC_PRIVATE_INPUT',sequence=1))
            self.assertEqual(f.store.writes,[]);self.assertEqual(f.children,[])
        f=self.original('key');view=self.plan(f)
        def failed(*args):raise ConnectionError('SYNTHETIC_PRIVATE_KEY_ERROR')
        f.key_hook=failed;result=f.manager.start(f.request(view,request_id='key-check'));self.assertEqual(result['reason'],'key_check_failed');self.assertNotIn('SYNTHETIC',json.dumps(result))

    def test_current_saved_key_profile_keeps_its_existing_route_instead_of_gaining_a_new_guide(self):
        f=self.original('key')
        with self.assertRaisesRegex(auth.AuthError,'saved_connection_changed'):f.plan()
        self.assertEqual(f.children,[]);self.assertEqual(f.calls,[])

    def test_corrupted_source_records_still_allow_owned_read_and_cancel_cleanup(self):
        f=self.original();view,s=self.started(f);receipt=copy.deepcopy(view['sourceReceipt']);f.store.runs['original-run']=None
        f.manager._supervise_once();result=f.manager.read(f.request(view,cursor=0));self.assertEqual(result['reason'],'original_run_unavailable')
        self.assertEqual(result['sourceReceipt'],receipt);self.assertEqual(f.manager.finish(f.request(view,retain=False))['sourceReceipt'],receipt)
        g=AuthFixture(self);current=g.plan();g.manager._profile=lambda _identifier:None;g.manager._supervise_once()
        self.assertEqual(g.manager.read(g.request(current,cursor=0))['status'],'needs_human_auth')
        self.assertEqual(g.manager.finish(g.request(current,retain=False))['reason'],'saved_connection_changed')


if __name__=='__main__':unittest.main()
