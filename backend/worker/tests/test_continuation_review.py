import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.adapters import Adapter
from studio_worker.service import Service
from studio_worker.server import dispatch

class ContinuationReview(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.inputs=self.root/'inputs';self.inputs.mkdir()
        (self.inputs/'model.xyz').write_text('1\nProperties=species:S:1:pos:R:3:vel:R:3\nH 0 0 0 1 2 3\n')
        (self.inputs/'nep.txt').write_text('fixture potential')
        (self.inputs/'run.in').write_text('potential nep.txt\nensemble nve\nrun 10\n')
        self.service=Service(self.root/'worker',schedule=False);self.addCleanup(lambda: (self.service.close(), self.service.store.db.close()))
        self.env=self.service.register_environment({'name':'fixture','executables':{'gpumd':sys.executable,'python':sys.executable}})
        self.project=self.service.register_project({'name':'fixture','policy':{'input_roots':[str(self.inputs)],'environments':[self.env['id']]}})
    def parent(self):
        p=self.service.prepare({'project_id':self.project['id'],'environment_id':self.env['id'],'engine':'gpumd.md','gpu':0,'max_seconds':60,'inputs':{n:str(self.inputs/n) for n in ['model.xyz','nep.txt','run.in']},'parameters':{'structure':{'has_initial_velocities':False},'dynamics':{'velocity_initialization_temperature_K':300,'steps':10}},'name':'parent','idempotency_key':'parent'})
        self.service.store.update(p,status='succeeded',exit_code=0)
        (Path(p['directory'])/'results/restart.xyz').write_bytes((self.inputs/'model.xyz').read_bytes())
        return self.service.store.run(p['id'])
    def child(self):
        p=self.parent();q={'checkpoint_files':['restart.xyz'],'continuation_run_in':str(self.inputs/'run.in'),'idempotency_key':'child'}
        return p,self.service.resume(p['id'],q)
    def test_review_keeps_owned_terminal_parent_and_immediate_revision_chain(self):
        p,c=self.child();changes={'max_seconds':30,'idempotency_key':'review1'}
        r=self.service.revise(c['id'],changes,{})
        self.assertEqual(r['parent_run'],p['id']);self.assertEqual(r['revision_of'],c['id'])
        self.assertEqual(self.service.revise(c['id'],changes,{})['id'],r['id'])
        r2=self.service.revise(r['id'],{'idempotency_key':'review2'},{});self.assertEqual(r2['parent_run'],p['id']);self.assertEqual(r2['revision_of'],r['id'])
        with self.assertRaisesRegex(ValueError,'Unsupported review field'):self.service.revise(r2['id'],{'parent_run':p['id'],'idempotency_key':'forged'},{})
        with self.assertRaisesRegex(ValueError,'different reviewed inputs'):self.service.revise(c['id'],{**changes,'max_seconds':20},{})
    def test_owned_parent_guards_rechecked_not_added_renderer_authority(self):
        p,c=self.child();other=self.service.register_project({'name':'other','policy':{'input_roots':[str(self.inputs)],'environments':[self.env['id']]}})
        for update in [{'project_id':other['id']},{'project_id':p['project_id'],'status':'running'}]:
            self.service.store.update(p,**update)
            with self.assertRaisesRegex(PermissionError,'continuation parent'):self.service.revise(c['id'],{'idempotency_key':'blocked-'+str(update)},{})
        self.service.store.update(p,project_id=c['project_id'],status='succeeded')
        self.service.store.update(c,status='unknown')
        with self.assertRaisesRegex(ValueError,'Submitted inputs'):self.service.revise(c['id'],{'idempotency_key':'unknown'},{})

    def test_gpumd_resume_metadata_is_unknown_bound_and_does_not_mutate_parent(self):
        p=self.parent();old=copy.deepcopy(self.service.store.run(p['id']))
        q={'checkpoint_files':['restart.xyz'],'continuation_run_in':str(self.inputs/'run.in'),'idempotency_key':'metadata'}
        c=self.service.resume(p['id'],q);meta=c['continuation_metadata']
        self.assertNotIn('has_initial_velocities',c['parameters']['structure'])
        self.assertNotIn('velocity_initialization_temperature_K',c['parameters']['dynamics'])
        self.assertEqual(c['parameters']['dynamics']['steps'],10)
        self.assertEqual(meta['parameter_scope'],'inherited_unverified');self.assertIsNone(meta['checkpoint']['has_velocities'])
        self.assertEqual(meta['checkpoint']['velocity_status'],'not_checked');self.assertEqual(meta['velocity_initialization'],'no_velocity_command')
        snapshots={x['name']:x for x in c['snapshots']}
        self.assertEqual(meta['checkpoint']['sha256'],snapshots['model.xyz']['sha256']);self.assertEqual(meta['input']['sha256'],snapshots['run.in']['sha256'])
        self.assertEqual((Path(c['directory'])/'simulation/run.in').read_bytes(),(self.inputs/'run.in').read_bytes())
        self.assertEqual(self.service.store.run(p['id']),old)
        self.assertEqual(self.service.resume(p['id'],q),c)
        for status in ['running','unknown','succeeded']:
            self.service.store.update(c,status=status)
            before=copy.deepcopy(self.service.store.run(c['id']));repro=(Path(c['directory'])/'reproduction.json').read_bytes()
            self.assertEqual(self.service.resume(p['id'],q),before)
            self.assertEqual((Path(c['directory'])/'reproduction.json').read_bytes(),repro)
        (self.inputs/'other.in').write_text('run 20\n')
        with self.assertRaisesRegex(ValueError,'different request'):self.service.resume(p['id'],{**q,'continuation_run_in':str(self.inputs/'other.in')})

    def test_command_metadata_uses_actual_immutable_snapshot(self):
        p=self.parent();prepare=self.service.prepare
        def changed_input(spec):
            (self.inputs/'run.in').write_text('potential nep.txt\nvelocity 300\nrun 10\n')
            return prepare(spec)
        self.service.prepare=changed_input
        c=self.service.resume(p['id'],{'checkpoint_files':['restart.xyz'],'continuation_run_in':str(self.inputs/'run.in'),'idempotency_key':'changed-before-snapshot'})
        self.assertEqual(c['continuation_metadata']['velocity_initialization'],'not_checked')
        self.assertIsNone(c['continuation_metadata']['checkpoint']['has_velocities'])

    def assert_invalid_continuation_cannot_dispatch(self, child):
        with patch.object(Adapter,'probe',return_value={'status':'not_run','scope':'software fixture skips environment probe'}), patch.object(Adapter,'runtime_check',return_value={'status':'not_run','scope':'software fixture skips loader observation'}):
            result=self.service.validate(child['id'])
        self.assertEqual(result['status'],'draft');self.assertEqual(result['validation']['status'],'failed')
        self.assertIn('velocity',result['validation']['message'])
        with self.assertRaisesRegex(ValueError,'velocity'):self.service.submit(child['id'])
        # A legacy ready snapshot must also face the current first-dispatch contract.
        self.service.store.update(child,status='ready',validation={'status':'passed'})
        with self.assertRaisesRegex(ValueError,'velocity'):self.service.submit(child['id'])
        stored=self.service.store.run(child['id']);self.assertEqual(stored['status'],'ready');self.assertIsNone(stored.get('identity'))

    def test_actual_snapshot_race_cannot_validate_or_first_dispatch(self):
        p=self.parent();before=copy.deepcopy(self.service.store.run(p['id']));checkpoint=(Path(p['directory'])/'results/restart.xyz').read_bytes();prepare=self.service.prepare
        def changed(spec):
            (self.inputs/'run.in').write_text('potential nep.txt\nvelocity 300\nrun 10\n')
            return prepare(spec)
        self.service.prepare=changed
        c=self.service.resume(p['id'],{'checkpoint_files':['restart.xyz'],'continuation_run_in':str(self.inputs/'run.in'),'idempotency_key':'guard-race'})
        self.service.prepare=prepare
        self.assert_invalid_continuation_cannot_dispatch(c)
        self.assertEqual(self.service.store.run(p['id']),before);self.assertEqual((Path(p['directory'])/'results/restart.xyz').read_bytes(),checkpoint)

    def test_review_added_velocity_cannot_validate_or_first_dispatch(self):
        p,c=self.child();before=copy.deepcopy(self.service.store.run(p['id']));checkpoint=(Path(p['directory'])/'results/restart.xyz').read_bytes()
        r=self.service.revise(c['id'],{'idempotency_key':'guard-reviewed'},{'run.in':'potential nep.txt\nvelocity 300\nrun 10\n'})
        self.assertEqual(r['parent_run'],p['id']);self.assert_invalid_continuation_cannot_dispatch(r)
        self.assertEqual(self.service.store.run(p['id']),before);self.assertEqual((Path(p['directory'])/'results/restart.xyz').read_bytes(),checkpoint)

    def test_exact_continuation_engines_reject_actual_velocity_but_fresh_md_allows_it(self):
        directory=self.inputs;(directory/'run.in').write_text('# velocity 100 is only a comment\npotential nep.txt\n  velocity 300 # actual initialization\nrun 10\n')
        for engine in ['gpumd.md','gpumd.sampling']:
            with self.assertRaisesRegex(ValueError,'velocity'):Adapter(engine).input_contract({'parent_run':'parent','parameters':{}},directory)
        self.assertEqual(Adapter('gpumd.md').input_contract({'parameters':{}},directory)['status'],'not_run')
        p=self.parent()
        with patch.object(Adapter,'probe',return_value={'status':'not_run'}),patch.object(Adapter,'runtime_check',return_value={'status':'not_run'}):
            self.service.store.update(p,status='draft');ready=self.service.validate(p['id'])
        self.assertEqual(ready['validation']['status'],'passed');self.assertEqual(self.service.submit(p['id'])['status'],'queued')

    def test_dispatched_statuses_return_without_rechecking_or_requeueing(self):
        p,c=self.child()
        for status in ['queued','running','unknown','succeeded','failed','cancelled']:
            self.service.store.update(c,status=status)
            before=copy.deepcopy(self.service.store.run(c['id']))
            with patch.object(Adapter,'input_contract',side_effect=AssertionError('No dispatched revalidation')):
                self.assertEqual(self.service.submit(c['id']),before)
            self.assertEqual(self.service.store.run(c['id']),before)

    def test_public_prepare_and_review_cannot_forge_metadata(self):
        p,c=self.child();spec={**p,'idempotency_key':'forged','continuation_metadata':{'parameter_scope':'verified'}}
        with self.assertRaisesRegex(ValueError,'worker-owned'):self.service.prepare(spec)
        with self.assertRaisesRegex(ValueError,'worker-owned'):dispatch(self.service,'POST','/api/runs/prepare',{'spec':spec},admin=False)
        with self.assertRaisesRegex(ValueError,'Unsupported review field'):self.service.revise(c['id'],{'idempotency_key':'forged-review','continuation_metadata':{}},{})

    def test_revision_preserves_owned_metadata_and_invalidates_changed_input_claim(self):
        p,c=self.child();m=copy.deepcopy(c['continuation_metadata'])
        r=self.service.revise(c['id'],{'idempotency_key':'meta-revision'},{});self.assertEqual(r['continuation_metadata'],m)
        r2=self.service.revise(r['id'],{'idempotency_key':'meta-revision2'},{'run.in':'potential nep.txt\nvelocity 300\nrun 1\n'})
        self.assertEqual(r2['continuation_metadata']['parent_run'],p['id'])
        self.assertEqual(r2['continuation_metadata']['velocity_initialization'],'not_checked')
        self.assertNotEqual(r2['continuation_metadata']['input']['sha256'],m['input']['sha256'])
        self.assertEqual(self.service.store.run(c['id'])['continuation_metadata'],m)

    def test_model_edit_or_replacement_clears_restart_source_but_same_bytes_keep_it(self):
        p,c=self.child();original=copy.deepcopy(c['continuation_metadata'])
        same=self.inputs/'same.xyz';same.write_bytes((Path(c['directory'])/'simulation/model.xyz').read_bytes())
        r=self.service.revise(c['id'],{'idempotency_key':'same-model','inputs':{**c['inputs'],'model.xyz':str(same)}},{})
        self.assertEqual(r['continuation_metadata']['checkpoint']['source_name'],'restart.xyz')
        self.assertEqual(r['continuation_metadata']['velocity_initialization'],'no_velocity_command')
        r2=self.service.revise(r['id'],{'idempotency_key':'edited-model'},{'model.xyz':'1\nProperties=species:S:1:pos:R:3\nH 1 0 0\n'})
        metadata=r2['continuation_metadata'];self.assertIsNone(metadata['checkpoint']['source_name']);self.assertEqual(metadata['velocity_initialization'],'not_checked')
        self.assertEqual(metadata['checkpoint']['sha256'],next(x['sha256'] for x in r2['snapshots'] if x['name']=='model.xyz'))
        self.assertEqual(r2['parent_run'],p['id']);self.assertEqual(r2['revision_of'],r['id'])
        changed=self.inputs/'changed.xyz';changed.write_text('1\nProperties=species:S:1:pos:R:3\nH 2 0 0\n')
        r3=self.service.revise(r2['id'],{'idempotency_key':'replaced-model','inputs':{**r2['inputs'],'model.xyz':str(changed)}},{})
        self.assertIsNone(r3['continuation_metadata']['checkpoint']['source_name']);self.assertEqual(r3['continuation_metadata']['velocity_initialization'],'not_checked')
        self.assertEqual(self.service.store.run(c['id'])['continuation_metadata'],original)

    def test_absent_velocities_never_guessed_and_non_gpumd_unchanged(self):
        (self.inputs/'model.xyz').write_text('1\nProperties=species:S:1:pos:R:3\nH 0 0 0\n')
        p,c=self.child();self.assertIsNone(c['continuation_metadata']['checkpoint']['has_velocities'])
        (self.inputs/'run.py').write_text('print(1)\n')
        params={'structure':{'has_initial_velocities':False},'dynamics':{'velocity_initialization_temperature_K':300}}
        p=self.service.prepare({'project_id':self.project['id'],'environment_id':self.env['id'],'engine':'pydyn.md','gpu':0,'max_seconds':60,'inputs':{'run.py':str(self.inputs/'run.py')},'parameters':params,'idempotency_key':'pydyn-parent'})
        self.service.store.update(p,status='succeeded')
        (Path(p['directory'])/'results/checkpoint.dat').write_text('actual fixture')
        c=self.service.resume(p['id'],{'checkpoint_files':['checkpoint.dat'],'continuation_script':str(self.inputs/'run.py'),'idempotency_key':'pydyn-child'})
        self.assertEqual(c['parameters']['structure'],params['structure']);self.assertEqual(c['parameters']['dynamics'],params['dynamics']);self.assertNotIn('continuation_metadata',c)

if __name__=='__main__':unittest.main()
