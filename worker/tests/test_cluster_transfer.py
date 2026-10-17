"""Filesystem/SSH-protocol fixtures only: no network, scheduler or science runs."""
import base64
import hashlib
import io
import json
import os
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.cluster import Clusters, TRANSFER_CHUNK, parse_output


def payload(script):
    code = shlex.split(script)[-1]
    match = re.search(r"base64.b64decode\('([^']+)'\)", code)
    return code, json.loads(base64.b64decode(match.group(1)))


class LocalTransferWire:
    """Execute only the read-only transfer program against isolated local files."""
    calls = []
    response_sizes = []
    chunk_count = 0
    fail_chunk = None
    corrupt_chunk = False
    after_chunk = None
    manifest_name = None

    def __init__(self, profile):
        self.profile = profile

    def run(self, script, data=None, timeout=40):
        code, value = payload(script)
        if value.get("op") not in ("stat", "chunk", "list") or data is not None:
            raise AssertionError("Fixture must never execute a scheduler command")
        self.calls.append(value)
        if value["op"] == "chunk":
            type(self).chunk_count += 1
            if self.fail_chunk == self.chunk_count:
                raise ConnectionError("Fixture interrupted transport")
        completed = subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=timeout)
        if completed.returncode:
            raise ValueError("Fixture remote validation rejected the request")
        out = completed.stdout.decode("utf8")
        self.response_sizes.append(len(completed.stdout))
        if value["op"] == "chunk":
            if self.corrupt_chunk:
                result = parse_output(out)
                block = base64.b64decode(result["base64"])
                result["base64"] = base64.b64encode(bytes([block[0] ^ 1]) + block[1:]).decode()
                out = "__STUDIO_JSON__" + json.dumps(result)
            if self.after_chunk:
                type(self).after_chunk(value)
        if value["op"] == "list" and self.manifest_name:
            result = parse_output(out)
            result["files"][0]["name"] = self.manifest_name
            out = "__STUDIO_JSON__" + json.dumps(result)
        return out


class ReceiptWire:
    """Scheduler receipts are fixture data; nothing is submitted."""
    calls = []
    def __init__(self, profile):
        pass
    def run(self, script, data=None, timeout=40):
        _, value = payload(script)
        self.calls.append(value)
        if data is not None:
            out = {"nonce":value["nonce"], "job_id":"123"}
        elif "job_id" in value:
            out = {"job_id":"123", "scheduler_state":"RUN", "identity_verified":True}
        else:
            out = {"text":"fixture", "offset":7}
        return "__STUDIO_JSON__"+json.dumps(out)


@unittest.skipUnless(os.name == "posix", "Read-only target program is Linux; run worker tests under WSL")
class ClusterTransfer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.inputs = self.root/"local-inputs"; self.inputs.mkdir()
        (self.inputs/"run.py").write_text("print('fixture; not executed')\n")
        self.remote = self.root/"remote-inputs"; self.remote.mkdir()
        self.remote_runs = self.root/"remote-runs"; self.remote_runs.mkdir()
        self.service = Service(self.root/"service", schedule=False)
        self.clusters = Clusters(self.service, transport=LocalTransferWire)
        self.service.clusters = self.clusters
        p = self.clusters.register({"name":"transfer fixture", "scheduler":"lsf", "target":"fixture@example.test", "ssh_client":"/usr/bin/ssh", "remote_root":str(self.remote_runs), "read_roots":[str(self.remote)], "queue":"fixture", "environment":{"executables":{"python":sys.executable, "gpu-sampling":"/usr/bin/false"}}})
        self.cluster_id = p["id"]
        self.project = self.service.register_project({"name":"transfer fixture", "policy":{"input_roots":[str(self.inputs)], "clusters":[self.cluster_id]}})
        LocalTransferWire.calls = []; LocalTransferWire.response_sizes = []; LocalTransferWire.chunk_count = 0
        LocalTransferWire.fail_chunk = None; LocalTransferWire.corrupt_chunk = False; LocalTransferWire.after_chunk = None; LocalTransferWire.manifest_name = None
        ReceiptWire.calls = []

    def tearDown(self):
        self.service.close(); self.service.store.db.close(); self.tmp.cleanup()

    def spec(self, **changes):
        return {"project_id":self.project["id"], "cluster_id":self.cluster_id, "engine":"pydyn.md", "inputs":{"run.py":str(self.inputs/"run.py")}, "parameters":{}, "gpu":0, "max_seconds":60, "idempotency_key":"fixture-key", "resources":{"cpus":1,"gpus":0,"memory_mb":1024,"queue":"fixture"}, **changes}

    def remote_file(self, name="large.dat", data=None):
        target = self.remote/name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data if data is not None else b"sample0123456789"*(TRANSFER_CHUNK//8))
        return target

    def terminal(self, **changes):
        result = self.clusters.prepare(self.spec(**changes))
        run = self.clusters.raw(result["id"])
        self.clusters.save(run, status="succeeded", scientific_validation={"status":"passed","scope":"fixture receipt, not scientific validation"})
        d = Path(run["remote_directory"]); d.mkdir()
        (d/"simulation").mkdir()
        (d/"console.log").write_text("fixture complete\n")
        (d/"environment.json").write_text('{}')
        (d/"validation.json").write_text('{"status":"passed","fixture":true}')
        (d/"exit.json").write_text(json.dumps({"nonce":run["nonce"],"exit_code":0}))
        (d/"simulation"/"thermo.out").write_text("0 300 0\n")
        return run, d

    def assert_no_partial_prepare(self):
        self.assertFalse(self.service.store.list("cluster-run"))
        runs = self.service.root/"cluster-runs"
        self.assertFalse(runs.exists() and list(runs.iterdir()))

    def assert_no_partial_collection(self, run):
        self.assertFalse(list(Path(run["directory"]).glob('.collect-*')))
        self.assertFalse(self.service.store.list("artifact"))
        self.assertFalse(self.service.store.list("cluster-collection"))
        self.assertFalse((Path(run["directory"])/"results").exists())

    def test_remote_input_chunks_hashes_adapter_map_and_idempotency(self):
        source = self.remote_file()
        spec = self.spec(remote_inputs={"assets/large.dat":str(source)}, directory_name="short-test")
        first = self.clusters.prepare(spec)
        snapshot = Path(first["directory"])/"simulation"/"assets"/"large.dat"
        self.assertEqual(snapshot.read_bytes(), source.read_bytes())
        self.assertEqual(first["inputs"]["assets/large.dat"], str(source))
        asset = next(a for a in first["snapshots"] if a["name"] == "assets/large.dat")
        self.assertEqual(asset["source_kind"], "remote")
        self.assertEqual(asset["sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertGreaterEqual(LocalTransferWire.chunk_count, 2)
        self.assertTrue(all(c["length"] <= TRANSFER_CHUNK for c in LocalTransferWire.calls if c["op"] == "chunk"))
        self.assertTrue(all(n < 4*1024*1024 for n in LocalTransferWire.response_sizes))
        count = len(LocalTransferWire.calls)
        self.assertEqual(first["id"], self.clusters.prepare(spec)["id"])
        self.assertEqual(count, len(LocalTransferWire.calls))
        self.assertEqual(first["status"], "draft"); self.assertEqual(first["scientific_validation"]["status"], "not_run")
        self.assertEqual(Path(first["remote_directory"]).name, "short-test-"+first["id"])
        with tarfile.open(fileobj=io.BytesIO(self.clusters.archive(self.clusters.raw(first["id"]))), mode="r:gz") as archive:
            saved = json.load(archive.extractfile('.studio/run.json'))
            self.assertIn('assets/large.dat', saved['inputs'])
            self.assertEqual(archive.extractfile('simulation/assets/large.dat').read(), source.read_bytes())

    def test_simultaneous_prepare_retries_share_one_remote_snapshot(self):
        from concurrent.futures import ThreadPoolExecutor
        source = self.remote_file(data=b'fixture parallel retry')
        spec = self.spec(remote_inputs={'parallel.dat':str(source)})
        with ThreadPoolExecutor(max_workers=2) as executor:
            result = list(executor.map(lambda _:self.clusters.prepare(spec), range(2)))
        self.assertEqual(result[0]['id'], result[1]['id'])
        self.assertEqual(len(self.service.store.list('cluster-run')),1)
        self.assertEqual(len([c for c in LocalTransferWire.calls if c['op']=='chunk']),1)

    def test_sampling_contract_accepts_remote_only_required_names(self):
        files = {name:str(self.remote_file(name, b'fixture')) for name in ('run.in','model.xyz','GAScfg.yaml','bias.pt')}
        run = self.clusters.prepare(self.spec(engine='gpumd.sampling', inputs={}, remote_inputs=files, parameters={'bias_file':'bias.pt','structure_file':'model.xyz','cv_size':1,'cutoff':5,'mode':'metad'}, resources={'cpus':1,'gpus':1,'memory_mb':1024,'queue':'fixture'}))
        self.assertEqual(set(run['inputs']), set(files))
        self.assertEqual(run['command'], ['/usr/bin/false'])
        self.assertEqual(len(run['snapshots']), 4)

    def test_colliding_names_and_invalid_prefixes_rejected_without_transport(self):
        source = self.remote_file(data=b'fixture')
        with self.assertRaises(ValueError):
            self.clusters.prepare(self.spec(remote_inputs={'run.py':str(source)}))
        for name in ('/absolute','../escape','nested/name','.','..','-bad','bad name'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.clusters.prepare(self.spec(directory_name=name))
        self.assertFalse(LocalTransferWire.calls); self.assert_no_partial_prepare()

    def test_remote_paths_traversal_outside_roots_and_symlinks_rejected(self):
        source = self.remote_file(data=b'fixture')
        outside = self.root/'outside'; outside.mkdir(); (outside/'secret').write_text('fixture outside')
        (self.remote/'linked-file').symlink_to(outside/'secret')
        (self.remote/'linked-directory').symlink_to(outside, target_is_directory=True)
        for source_path in (str(outside/'secret'),str(self.remote/'..'/'outside'/'secret'),str(self.remote/'linked-file'),str(self.remote/'linked-directory'/'secret')):
            with self.subTest(path=source_path), self.assertRaises(ValueError):
                self.clusters.prepare(self.spec(remote_inputs={'asset.dat':source_path}))
            self.assert_no_partial_prepare()
        value = self.clusters.store.get('cluster', self.cluster_id); value['read_roots'] = []; self.clusters.store.put('cluster',value)
        with self.assertRaises(PermissionError):self.clusters.prepare(self.spec(remote_inputs={'asset.dat':str(source)}))

    def test_interrupted_corrupt_or_mutated_input_is_cleaned(self):
        source = self.remote_file()
        for mode in ('lost','corrupt','mutated'):
            LocalTransferWire.chunk_count = 0; LocalTransferWire.fail_chunk = 1 if mode == 'lost' else None; LocalTransferWire.corrupt_chunk = mode == 'corrupt'
            LocalTransferWire.after_chunk = (lambda _: source.write_bytes(b'changed fixture')) if mode == 'mutated' else None
            with self.subTest(mode=mode), self.assertRaises((ValueError,ConnectionError)):
                self.clusters.prepare(self.spec(remote_inputs={'asset.dat':str(source)}))
            self.assert_no_partial_prepare()

    def test_input_total_size_bound_and_empty_file(self):
        source = self.remote_file(data=b'x'*100)
        with patch('studio_worker.cluster.TRANSFER_TOTAL',64), self.assertRaises(ValueError):
            self.clusters.prepare(self.spec(remote_inputs={'asset.dat':str(source)}))
        self.assert_no_partial_prepare()
        source.write_bytes(b'')
        run = self.clusters.prepare(self.spec(remote_inputs={'empty.dat':str(source)}))
        asset = next(a for a in run['snapshots'] if a['name']=='empty.dat')
        self.assertEqual(asset['size'],0); self.assertEqual(asset['sha256'],hashlib.sha256(b'').hexdigest())

    def test_directory_prefix_is_used_by_submission_poll_and_log(self):
        self.clusters.transport = ReceiptWire
        run = self.clusters.prepare(self.spec(directory_name='pilot'))
        self.clusters.validate(run['id']); self.clusters.submit(run['id']); self.clusters.poll(run['id']); self.clusters.read(run['id'])
        self.assertEqual(len(ReceiptWire.calls),3)
        self.assertTrue(all(p['directory']=='pilot-'+run['id'] for p in ReceiptWire.calls))

    def test_terminal_collection_hashes_default_whitelist_and_stable_asset_ids(self):
        run, directory = self.terminal(directory_name='pilot')
        (directory/'simulation'/'not-a-default.secret').write_text('fixture unselected')
        first = self.clusters.collect(run['id'])
        self.assertEqual(first['manifest']['transfer_status'],'passed')
        self.assertEqual(len(first['files']),5)
        self.assertNotIn('simulation/not-a-default.secret',[x['name'] for x in first['files']])
        for asset in first['files']:
            self.assertEqual(hashlib.sha256(Path(asset['path']).read_bytes()).hexdigest(),asset['sha256'])
            self.assertEqual(asset['metadata']['source']['run_id'],run['id'])
            self.assertEqual(asset['metadata']['source']['remote_sha256'],asset['sha256'])
        second = self.clusters.collect(run['id'])
        self.assertEqual(first['manifest'], second['manifest'])
        self.assertEqual(first['files'],second['files'])
        self.assertEqual(len(self.service.store.list('artifact')),5)
        self.assertEqual(len(self.service.store.list('cluster-collection')),1)

    def test_collect_requires_terminal_run_and_safe_selected_names(self):
        run = self.clusters.prepare(self.spec())
        with self.assertRaises(ValueError):self.clusters.collect(run['id'])
        self.assertFalse(LocalTransferWire.calls)
        raw = self.clusters.raw(run['id']); self.clusters.save(raw,status='failed')
        for names in (['../outside'],['/absolute'],['nested/../outside'],['.studio/run.json'],['collection.json'],['console.log','console.log'],[]):
            with self.subTest(names=names), self.assertRaises(ValueError):self.clusters.collect(run['id'],names)
        self.assertFalse(LocalTransferWire.calls)

    def test_result_symlink_or_unexpected_manifest_cannot_escape(self):
        run, directory = self.terminal()
        outside = self.root/'outside-result'; outside.write_text('outside fixture')
        (directory/'simulation'/'linked.out').symlink_to(outside)
        with self.assertRaises(ValueError):self.clusters.collect(run['id'],['simulation/linked.out'])
        self.assert_no_partial_collection(run)
        LocalTransferWire.manifest_name = '../outside'
        with self.assertRaises(ValueError):self.clusters.collect(run['id'],['console.log'])
        self.assert_no_partial_collection(run)

    def test_interrupted_collection_leaves_no_partial_assets(self):
        run, directory = self.terminal()
        (directory/'simulation'/'dump.xyz').write_bytes(b'x'*(TRANSFER_CHUNK+9))
        LocalTransferWire.fail_chunk = 2
        with self.assertRaises(ConnectionError):self.clusters.collect(run['id'],['console.log','simulation/dump.xyz'])
        self.assert_no_partial_collection(run)

    def test_existing_remote_or_local_content_conflict_is_never_overwritten(self):
        run, directory = self.terminal()
        first = self.clusters.collect(run['id'],['console.log']); asset=first['files'][0]
        target=Path(asset['path']); before=target.read_bytes()
        (directory/'console.log').write_text('different fixture result')
        with self.assertRaises(ValueError):self.clusters.collect(run['id'],['console.log'])
        self.assertEqual(target.read_bytes(),before); self.assertEqual(len(self.service.store.list('artifact')),1)
        (directory/'console.log').write_bytes(before); target.write_text('local edit')
        with self.assertRaises(ValueError):self.clusters.collect(run['id'],['console.log'])
        self.assertEqual(target.read_text(),'local edit')
        self.assertFalse(list(Path(run['directory']).glob('.collect-*')))

    def test_collection_adds_new_files_without_changing_existing_asset_identity(self):
        run, directory = self.terminal()
        first=self.clusters.collect(run['id'],['console.log'])['files'][0]
        second=self.clusters.collect(run['id'],['console.log','simulation/thermo.out'])
        self.assertEqual(next(a for a in second['files'] if a['name']=='console.log'),first)
        self.assertEqual(len(self.service.store.list('artifact')),2)
        self.assertEqual(len(self.service.store.list('cluster-collection')),2)

    def test_explicit_missing_result_is_an_error_and_default_missing_is_recorded(self):
        run, _ = self.terminal()
        with self.assertRaises(ValueError):self.clusters.collect(run['id'],['absent.out'])
        self.assert_no_partial_collection(run)
        recovered=self.clusters.collect(run['id'])
        self.assertIn('simulation/dump.xyz',recovered['manifest']['missing'])

    def test_collection_total_bound_and_different_selection_manifests(self):
        run, directory = self.terminal()
        with patch('studio_worker.cluster.TRANSFER_TOTAL', 4), self.assertRaises(ValueError):
            self.clusters.collect(run['id'],['console.log'])
        self.assert_no_partial_collection(run)
        selected=self.clusters.collect(run['id'],['console.log'])
        default=self.clusters.collect(run['id'])
        self.assertEqual(selected['manifest']['missing'],[])
        self.assertNotEqual(selected['manifest']['id'],default['manifest']['id'])
        self.assertTrue(default['manifest']['missing'])
        self.assertEqual(selected['files'][0]['id'], next(a['id'] for a in default['files'] if a['name']=='console.log'))

    def test_input_preview_is_local_snapshot_only_immutable_bounded_and_binary_aware(self):
        binary=self.remote_file('bias.pt',b'\x00\xffbinary fixture')
        run=self.clusters.prepare(self.spec(remote_inputs={'bias.pt':str(binary)}))
        calls=len(LocalTransferWire.calls)
        preview=self.clusters.input_file(run['id'],'run.py')
        self.assertEqual(preview['text'],(self.inputs/'run.py').read_text()); self.assertFalse(preview['editable']); self.assertEqual(preview['size'],len(preview['text'].encode()))
        binary_preview=self.clusters.input_file(run['id'],'bias.pt')
        self.assertTrue(binary_preview['binary']); self.assertFalse(binary_preview['preview_available']); self.assertNotIn('text',binary_preview)
        for name in ('not-recorded','../run.json','/run.py'):
            with self.subTest(name=name),self.assertRaises(ValueError):self.clusters.input_file(run['id'],name)
        self.assertEqual(calls,len(LocalTransferWire.calls))
        target=Path(run['directory'])/'simulation'/'run.py'; target.chmod(0o600); target.write_text('changed')
        with self.assertRaises(ValueError):self.clusters.input_file(run['id'],'run.py')

    def test_input_preview_declines_large_text_without_truncation(self):
        big=self.inputs/'big.txt'; big.write_bytes(b'x'*(2*1024*1024+1))
        run=self.clusters.prepare(self.spec(inputs={'run.py':str(self.inputs/'run.py'),'big.txt':str(big)}))
        result=self.clusters.input_file(run['id'],'big.txt')
        self.assertFalse(result['preview_available']); self.assertNotIn('text',result)
        self.assertEqual(result['sha256'],hashlib.sha256(big.read_bytes()).hexdigest())
