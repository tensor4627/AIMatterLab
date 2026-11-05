"""Opt-in queue authorization lifecycle; all SSH/scheduler replies are fixtures.

These are software/security tests, never real allocated-node or science evidence.
"""
import base64
import copy
import json
import re
import shlex
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.cluster import Clusters, profile, public, batch_script, word, target_id, ssh_endpoint
from studio_worker.server import dispatch
from studio_worker.service import Service


class FixtureSSH:
    calls = []
    lost = False

    def __init__(self, snapshot):
        self.snapshot = copy.deepcopy(snapshot)

    def run(self, script, data=None, timeout=40):
        self.calls.append((self.snapshot, script, data))
        encoded = re.search(r"base64.b64decode\('([^']+)'\)", shlex.split(script)[-1])
        payload = json.loads(base64.b64decode(encoded.group(1)))
        if data is not None:
            if self.lost:
                raise ConnectionError("Fixture lost acknowledgement")
            return "__STUDIO_JSON__" + json.dumps({"nonce":payload["nonce"], "job_id":"123"})
        return "__STUDIO_JSON__" + json.dumps({"job_id":payload.get("job_id"), "scheduler_state":"RUN", "identity_verified":True})


class QueueTargetLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        (self.inputs / "run.py").write_text("print('inert input fixture')")
        self.service = Service(self.root / "worker", schedule=False)
        self.cluster = Clusters(self.service, transport=FixtureSSH)
        self.service.clusters = self.cluster
        self.profile = self.cluster.register({
            "id":"fixture-cluster", "name":"Fixture", "scheduler":"slurm",
            "host":"fixture.invalid", "username":"fixture", "ssh_client":"/usr/bin/ssh",
            "remote_root":"/tmp/owned-fixture", "queue":"legacy",
            "environment":{"executables":{"python":"/fixture/legacy/python"}},
            "queue_targets":[self.target("owned"), self.target("paid", usage="paid"), self.target("unknown", usage="unknown")],
        })
        self.project = self.service.register_project({"id":"fixture-project", "name":"Fixture",
            "policy":{"input_roots":[str(self.inputs)], "clusters":[self.profile["id"]]}})
        FixtureSSH.calls = []
        FixtureSSH.lost = False

    def tearDown(self):
        self.service.close()
        self.service.store.db.close()
        self.tmp.cleanup()

    def target(self, identifier, *, usage="owned", cpus=4, enabled=True, engines=None):
        return {"id":identifier, "queue":identifier + "-queue", "usage_class":usage, "enabled":enabled,
            "engines":engines or ["pydyn.md"], "environment":{"executables":{"python":"/fixture/" + identifier + "/python"}, "repositories":{}, "variables":{}},
            "activation":"# activate " + identifier, "limits":{"cpus":cpus, "gpus":1, "memory_mb":4096, "max_seconds":120}, "account":identifier + "-account"}

    def authorize(self, order=("owned",), *, paid=False, version=None):
        policy = {"profile_version":version or self.profile["version"], "allowed_target_ids":list(order), "new_submission_order":list(order),
            "paid":{"permitted":paid, "conditions_known":paid, "conditions":"Fixture reviewed billing conditions" if paid else ""}}
        if paid:
            policy["paid"]["limits"] = {"cpus":4, "gpus":1, "memory_mb":4096, "max_seconds":120}
        current = self.service.store.get("project", self.project["id"])
        self.project = dispatch(self.service, "POST", "/api/projects", {**current,
            "policy":{**current["policy"], "cluster_queue_policies":{self.profile["id"]:policy}}}, admin=True)
        return policy

    def spec(self, *, resources=None, key="fixture-key", engine="pydyn.md", seconds=60):
        return {"project_id":self.project["id"], "cluster_id":self.profile["id"], "engine":engine,
            "inputs":{"run.py":str(self.inputs / "run.py")}, "parameters":{}, "gpu":0,
            "max_seconds":seconds, "idempotency_key":key,
            "resources":{"cpus":1, "gpus":0, "memory_mb":1024, **(resources or {})}}

    def saved_profile(self):
        return self.service.store.get("cluster", self.profile["id"])

    def test_lsf_literal_exclamation_queue_preserves_name_and_still_requires_policy(self):
        target = self.target("owned")
        target["queue"] = "!fixture_owned"
        self.profile = self.cluster.register({**self.saved_profile(), "scheduler":"lsf", "queue_targets":[target]})
        self.cluster._connection_result(self.saved_profile(), {"status":"passed"}, {"queues":[target["queue"]]})
        with self.assertRaisesRegex(PermissionError, "queue policy is not authorized"):
            self.cluster.prepare(self.spec(key="visible-literal-is-not-authority"))
        self.authorize()
        run = self.cluster.prepare(self.spec())
        self.assertEqual(run["resources"]["queue"], "!fixture_owned")
        self.assertEqual(run["queue_target_snapshot"]["queue"], "!fixture_owned")
        self.assertIn("#BSUB -q !fixture_owned", batch_script(self.cluster.raw(run["id"])))
        self.assertFalse(FixtureSSH.calls)

    def test_literal_exclamation_is_lsf_queue_only_not_general_tokens(self):
        saved = self.saved_profile();target = self.target("owned");target["queue"] = "fixture!"
        with self.assertRaises(ValueError):profile({**saved, "scheduler":"slurm", "queue_targets":[target]})
        for value in ("queue;bad", "queue\nother", "-q", "queue$(bad)"):
            target["queue"] = value
            with self.assertRaises(ValueError):profile({**saved, "scheduler":"lsf", "queue_targets":[target]})
        target["queue"] = "fixture!";target["account"] = "account!"
        with self.assertRaises(ValueError):profile({**saved, "scheduler":"lsf", "queue_targets":[target]})
        for call in (lambda:word("host!"),lambda:target_id("id!"),lambda:ssh_endpoint({"host":"host!", "username":"fixture"})):
            with self.assertRaises(ValueError):call()

    def test_legacy_lsf_literal_queue_is_preserved_without_new_target_policy_claim(self):
        saved = self.saved_profile();saved.pop("queue_targets")
        self.profile = self.cluster.register({**saved, "scheduler":"lsf", "queue":"fixture!"})
        run = self.cluster.prepare(self.spec(resources={"queue":"fixture!"}))
        self.assertEqual(run["resources"]["queue"], "fixture!")
        self.assertNotIn("queue_target_snapshot", run)
        self.assertIn("#BSUB -q fixture!", self.cluster.raw(run["id"])["script"])
        self.assertFalse(FixtureSSH.calls)

    def test_pending_native_import_requires_human_review_without_saved_profile_or_transport_change(self):
        before = self.saved_profile()
        pending = {**before, "import_review":{"requires_review":True, "reasons":["xshell_proxy_requires_review"]}}
        with self.assertRaisesRegex(ValueError, "human review"):self.cluster.register(pending)
        with self.assertRaisesRegex(ValueError, "human review"):self.cluster.test_connection(pending)
        self.assertEqual(self.saved_profile(), before)
        self.assertFalse(FixtureSSH.calls)

    def test_visible_queues_and_cluster_grant_never_authorize_targets(self):
        saved = self.saved_profile()
        self.cluster._connection_result(saved, {"status":"passed"}, {"queues":["owned-queue", "paid-queue"]})
        with self.assertRaisesRegex(PermissionError, "queue policy is not authorized"):
            self.cluster.prepare(self.spec())
        self.assertFalse(self.service.store.list("cluster-run"))
        self.assertFalse(FixtureSSH.calls)
        self.assertNotIn("cluster_queue_policies", self.service.store.get("project", self.project["id"])["policy"])

    def test_order_freezes_target_environment_activation_resources_and_policy(self):
        policy = self.authorize(("paid", "owned"), paid=True)
        run = self.cluster.prepare(self.spec())
        self.assertEqual(run["resources"]["queue_target_id"], "paid")
        self.assertEqual(run["resources"]["queue"], "paid-queue")
        self.assertEqual(run["resources"]["account"], "paid-account")
        raw = self.cluster.raw(run["id"])
        self.assertEqual(raw["command"][0], "/fixture/paid/python")
        self.assertEqual(raw["cluster_snapshot"]["environment"], raw["queue_target_snapshot"]["environment"])
        self.assertIn("# activate paid", raw["script"])
        self.assertIn("#SBATCH --partition=paid-queue", raw["script"])
        self.assertIn("#SBATCH --account=paid-account", raw["script"])
        self.assertEqual(raw["queue_policy_snapshot"], policy)
        self.assertEqual(raw["queue_profile_version"], self.profile["version"])
        self.assertEqual(len(raw["queue_policy_digest"]), 64)
        self.assertEqual(self.cluster.validate(run["id"])["status"], "ready")
        self.assertFalse(FixtureSSH.calls)

    def test_order_selects_only_compatible_engine_and_resources(self):
        saved = self.saved_profile()
        saved["queue_targets"] = [self.target("small", cpus=1), self.target("wrong-engine", engines=["gpumd.md"]), self.target("large")]
        self.profile = self.cluster.register(saved)
        self.authorize(("small", "wrong-engine", "large"))
        run = self.cluster.prepare(self.spec(resources={"cpus":2}))
        self.assertEqual(run["resources"]["queue_target_id"], "large")
        self.assertEqual(run["command"][0], "/fixture/large/python")

    def test_paid_and_unknown_targets_excluded_without_known_explicit_paid_policy(self):
        self.authorize(("paid", "unknown", "owned"))
        self.assertEqual(self.cluster.prepare(self.spec())["resources"]["queue_target_id"], "owned")
        for identifier in ("paid", "unknown"):
            with self.assertRaises(PermissionError):
                self.cluster.prepare(self.spec(resources={"queue_target_id":identifier}, key=identifier))
        self.authorize(("paid",), paid=True)
        for index in range(2):
            run = self.cluster.prepare(self.spec(key="paid-" + str(index)))
            self.assertEqual(run["resources"]["queue_target_id"], "paid")
            self.assertEqual(self.cluster.validate(run["id"])["status"], "ready")
        self.assertFalse(FixtureSSH.calls)  # No extra paid authorization API exists.

    def test_paid_limits_and_duration_are_enforced(self):
        self.authorize(("paid",), paid=True)
        project = self.service.store.get("project", self.project["id"])
        project["policy"]["cluster_queue_policies"][self.profile["id"]]["paid"]["limits"]["cpus"] = 1
        self.service.register_project(project)
        with self.assertRaisesRegex(PermissionError, "paid queue limits"):
            self.cluster.prepare(self.spec(resources={"cpus":2}))
        with self.assertRaises(PermissionError):
            self.cluster.prepare(self.spec(seconds=121, key="duration"))

    def test_explicit_unauthorized_disabled_or_small_target_never_falls_back(self):
        saved = self.saved_profile()
        saved["queue_targets"].extend([self.target("disabled", enabled=False), self.target("small", cpus=1)])
        self.profile = self.cluster.register(saved)
        self.authorize(("owned", "disabled", "small"))
        for identifier, cpus in (("paid", 1), ("disabled", 1), ("small", 2), ("missing", 1)):
            with self.assertRaises(PermissionError):
                self.cluster.prepare(self.spec(resources={"queue_target_id":identifier, "cpus":cpus}, key=identifier))
        self.assertFalse(self.service.store.list("cluster-run"))

    def test_queue_and_account_strings_cannot_bypass_order_or_target_policy(self):
        self.authorize(("owned", "paid"), paid=True)
        for field, value in (("queue", "paid-queue"), ("account", "paid-account"), ("queue", "outside"), ("account", "outside")):
            with self.assertRaisesRegex(PermissionError, "override differs"):
                self.cluster.prepare(self.spec(resources={field:value}, key=field + value))
        run = self.cluster.prepare(self.spec(resources={"queue":"owned-queue", "account":"owned-account"}))
        self.assertEqual(run["resources"]["queue_target_id"], "owned")

    def test_policy_and_profile_versions_reject_stale_prepare_validate_submit(self):
        self.authorize()
        run = self.cluster.prepare(self.spec())
        old = self.saved_profile()
        self.profile = self.cluster.register({**old, "name":"Changed fixture profile"})
        with self.assertRaisesRegex(ValueError, "reload before saving"):
            self.cluster.register(old)
        with self.assertRaisesRegex(ValueError, "profile version changed"):
            self.cluster.prepare(self.spec(key="new"))
        for action in (self.cluster.validate, self.cluster.submit):
            if action == self.cluster.submit:
                raw = self.cluster.raw(run["id"])
                self.cluster.save(raw, status="ready", validation={"status":"passed"})
            with self.assertRaisesRegex(ValueError, "profile changed"):
                action(run["id"])
        with self.assertRaisesRegex(ValueError, "profile version changed"):
            self.authorize(("owned", "paid"), version=old["version"])
        self.assertFalse(FixtureSSH.calls)

    def test_policy_revocation_and_conditions_change_block_existing_unsubmitted_drafts(self):
        self.authorize(("paid",), paid=True)
        run = self.cluster.prepare(self.spec())
        self.cluster.validate(run["id"])
        self.authorize(())
        for action in (self.cluster.validate, self.cluster.submit):
            with self.assertRaises(PermissionError):
                action(run["id"])
        self.authorize(("paid",), paid=True)
        project = self.service.store.get("project", self.project["id"])
        project["policy"]["cluster_queue_policies"][self.profile["id"]]["paid"]["conditions"] = "Changed reviewed conditions"
        self.service.register_project(project)
        with self.assertRaisesRegex(ValueError, "policy changed"):
            self.cluster.validate(run["id"])
        with self.assertRaises(ValueError):
            self.cluster.prepare(self.spec())
        self.assertFalse(FixtureSSH.calls)

    def test_mcp_cannot_write_project_queue_policy_or_register_target(self):
        project = copy.deepcopy(self.project)
        project["policy"]["cluster_queue_policies"] = {self.profile["id"]:{}}
        for route, value in (("/api/projects", project), ("/api/clusters", self.saved_profile())):
            with self.assertRaises(PermissionError):
                dispatch(self.service, "POST", route, value, admin=False)
        self.assertNotIn("cluster_queue_policies", self.service.store.get("project", self.project["id"])["policy"])

    def test_agent_can_only_draft_target_setup_and_cannot_forge_selection_receipts(self):
        original = self.saved_profile()
        draft = dispatch(self.service, "POST", "/api/cluster/draft", {
            "project_id":self.project["id"], "cluster_id":self.profile["id"],
            "proposal":{"queue_targets":[self.target("proposed")]}}, admin=False)
        self.assertEqual(draft["status"], "draft")
        self.assertEqual(self.saved_profile(), original)
        self.assertNotIn("cluster_queue_policies", self.service.store.get("project", self.project["id"])["policy"])
        for field in ("queue_target_snapshot", "queue_policy_snapshot", "queue_policy_digest", "queue_profile_version"):
            with self.assertRaisesRegex(ValueError, "worker-owned"):
                self.cluster.prepare({**self.spec(), field:"forged"})
        with self.assertRaises(ValueError):
            dispatch(self.service, "POST", "/api/cluster/draft", {
                "project_id":self.project["id"], "cluster_id":self.profile["id"],
                "proposal":{"cluster_queue_policies":{}}}, admin=False)
        self.assertFalse(self.service.store.list("cluster-run"))
        self.assertFalse(FixtureSSH.calls)

    def test_snapshot_monitoring_and_unknown_submission_never_select_or_dispatch_again(self):
        self.authorize()
        run = self.cluster.prepare(self.spec())
        self.cluster.validate(run["id"])
        FixtureSSH.lost = True
        self.assertEqual(self.cluster.submit(run["id"])["status"], "unknown")
        original = self.cluster.raw(run["id"])["cluster_snapshot"]
        saved = self.saved_profile()
        saved["queue_targets"][0]["environment"]["executables"]["python"] = "/fixture/new/python"
        self.profile = self.cluster.register(saved)
        self.authorize(())
        before = len(FixtureSSH.calls)
        self.cluster.submit(run["id"])
        self.assertEqual(len(FixtureSSH.calls), before)
        self.cluster.poll(run["id"])
        self.assertEqual(FixtureSSH.calls[-1][0], original)
        self.assertEqual(self.cluster.raw(run["id"])["cluster_snapshot"], original)
        self.assertEqual(sum(data is not None for _, _, data in FixtureSSH.calls), 1)

    def test_legacy_profiles_and_runs_keep_existing_semantics_without_policy_claim(self):
        saved = self.saved_profile()
        saved.pop("queue_targets")
        self.profile = self.cluster.register(saved)
        run = self.cluster.prepare(self.spec(resources={"queue":"legacy-override", "account":"legacy-account"}))
        self.assertNotIn("queue_target_snapshot", run)
        self.assertNotIn("queue_policy_snapshot", run)
        self.assertNotIn("queue_targets", public(saved))
        self.assertEqual(run["resources"]["queue"], "legacy-override")
        self.cluster.validate(run["id"])
        self.cluster.submit(run["id"])
        original = self.cluster.raw(run["id"])["cluster_snapshot"]
        self.profile = self.cluster.register({**self.saved_profile(), "queue_targets":[self.target("owned")]})
        self.cluster.poll(run["id"])
        self.assertEqual(FixtureSSH.calls[-1][0], original)
        self.assertNotIn("queue_policy_snapshot", self.cluster.raw(run["id"]))

    def test_empty_opt_in_targets_do_not_restore_legacy_permission(self):
        self.profile = self.cluster.register({**self.saved_profile(), "queue_targets":[]})
        self.authorize(())
        with self.assertRaises(PermissionError):
            self.cluster.prepare(self.spec(resources={"queue":"legacy"}))

    def test_profile_opt_out_cannot_remove_project_queue_constraints(self):
        self.authorize()
        original_run = self.cluster.prepare(self.spec(key="original-opt-in"))
        self.cluster.validate(original_run["id"])
        self.cluster.submit(original_run["id"])
        original_snapshot = self.cluster.raw(original_run["id"])["cluster_snapshot"]
        legacy = self.saved_profile()
        legacy.pop("queue_targets")
        self.profile = self.cluster.register(legacy)
        for queue in ("owned-queue", "outside-policy"):
            with self.assertRaisesRegex(PermissionError, "queue policy still applies"):
                self.cluster.prepare(self.spec(resources={"queue":queue}, key=queue))
        self.authorize(())  # Revocation also must not silently restore legacy use.
        with self.assertRaisesRegex(PermissionError, "queue policy still applies"):
            self.cluster.prepare(self.spec(resources={"queue":"outside-policy"}, key="revoked"))
        self.cluster.poll(original_run["id"])
        self.assertEqual(FixtureSSH.calls[-1][0], original_snapshot)
        self.assertEqual(self.cluster.raw(original_run["id"])["cluster_snapshot"], original_snapshot)
        project = self.service.store.get("project", self.project["id"])
        project["policy"]["cluster_queue_policies"].pop(self.profile["id"])
        dispatch(self.service, "POST", "/api/projects", project, admin=True)
        legacy_run = self.cluster.prepare(self.spec(resources={"queue":"explicitly-restored-legacy"}, key="human-reviewed-legacy"))
        self.assertNotIn("queue_policy_snapshot", legacy_run)
        self.assertEqual(legacy_run["resources"]["queue"], "explicitly-restored-legacy")
        self.assertEqual(len(self.service.store.list("cluster-run")), 2)

    def test_legacy_draft_revocation_blocks_first_dispatch_and_unknown_never_replays(self):
        legacy = self.saved_profile()
        legacy.pop("queue_targets")
        self.profile = self.cluster.register(legacy)
        run = self.cluster.prepare(self.spec(resources={"queue":"legacy"}, key="legacy-before-policy"))
        self.cluster.validate(run["id"])
        self.authorize(())
        for action in (self.cluster.validate, self.cluster.submit):
            with self.assertRaisesRegex(PermissionError, "queue policy still applies"):
                action(run["id"])
        blocked = self.cluster.raw(run["id"])
        self.assertEqual(blocked["status"], "ready")
        self.assertFalse(blocked.get("submit_attempted"))
        self.assertIsNone(blocked["job_id"])
        self.assertFalse(FixtureSSH.calls)
        project = self.service.store.get("project", self.project["id"])
        project["policy"]["cluster_queue_policies"].pop(self.profile["id"])
        dispatch(self.service, "POST", "/api/projects", project, admin=True)
        FixtureSSH.lost = True
        self.assertEqual(self.cluster.submit(run["id"])["status"], "unknown")
        attempted = self.cluster.raw(run["id"])
        self.assertEqual(sum(data is not None for _, _, data in FixtureSSH.calls), 1)
        self.authorize(())
        for _ in range(2):
            self.assertEqual(self.cluster.submit(run["id"])["status"], "unknown")
        self.assertEqual(sum(data is not None for _, _, data in FixtureSSH.calls), 1)
        self.assertEqual(self.cluster.raw(run["id"]), attempted)

    def test_target_and_policy_schema_rejects_ambiguous_or_unreviewed_values(self):
        base = self.saved_profile()
        for field, value in (("id", "../escape"), ("enabled", 1), ("usage_class", "free"), ("engines", []), ("engines", [{}]), ("limits", {"cpus":1})):
            target = self.target("bad")
            target[field] = value
            with self.assertRaises(ValueError):
                profile({**base, "queue_targets":[target]})
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            profile({**base, "queue_targets":[self.target("same"), self.target("same")]})
        self.authorize()
        original = self.service.store.get("project", self.project["id"])
        for update in ({"new_submission_order":[]}, {"allowed_target_ids":["missing"], "new_submission_order":["missing"]},
                       {"paid":{"permitted":True, "conditions_known":False}}, {"profile_version":True}):
            project = copy.deepcopy(original)
            project["policy"]["cluster_queue_policies"][self.profile["id"]].update(update)
            with self.assertRaises(ValueError):
                self.service.register_project(project)
        self.assertEqual(self.service.store.get("project", self.project["id"]), original)

    def test_probe_observes_both_families_without_rewriting_selected_scheduler_or_grants(self):
        import subprocess
        import types
        # Execute only the generated probe body with in-memory subprocess/path
        # fixtures. No SSH client or scheduler program is ever executed.
        commands = {name:"/fixture/bin/" + name for name in ("bsub", "bjobs", "bqueues", "sbatch", "squeue", "sinfo")}
        calls = []
        def read_only(argv, **kwargs):
            calls.append(argv)
            output = "lsf-visible\n" if argv[0] == "bqueues" else "slurm-visible*\n"
            return subprocess.CompletedProcess(argv, 0, output, "")
        class ProbeTransport:
            def run(_self, script, **kwargs):
                code = shlex.split(script)[-1]
                fake_pwd = types.SimpleNamespace(getpwuid=lambda _:types.SimpleNamespace(pw_name="fixture"))
                with patch.dict(sys.modules, {"pwd":fake_pwd}), patch("os.geteuid", return_value=0, create=True), patch("shutil.which", side_effect=lambda name:commands.get(name)), patch("subprocess.run", side_effect=read_only), patch("builtins.print") as printed:
                    exec(code, {})
                return printed.call_args.args[0]
        before = self.saved_profile()
        project = self.service.store.get("project", self.project["id"])
        self.cluster.transport = lambda _:ProbeTransport()
        result = self.cluster.probe(self.profile["id"])
        self.assertEqual(result["detected_schedulers"], ["lsf", "slurm"])
        self.assertTrue(result["selected_scheduler_match"])
        self.assertEqual(result["selected_scheduler"], "slurm")
        self.assertEqual(result["queues"], ["slurm-visible"])
        self.assertEqual(result["schedulers"]["lsf"]["queues"], ["lsf-visible"])
        self.assertEqual([argv[0] for argv in calls], ["bqueues", "sinfo"])
        self.assertEqual(self.saved_profile()["scheduler"], before["scheduler"])
        self.assertEqual(self.saved_profile()["version"], before["version"])
        self.assertEqual(self.saved_profile()["queue_targets"], before["queue_targets"])
        self.assertEqual(self.service.store.get("project", self.project["id"]), project)
        self.assertIn("scientific validation not_run", result["scope"])
        commands.pop("sbatch")
        result = self.cluster.probe(self.profile["id"])
        self.assertFalse(result["selected_scheduler_match"])
        self.assertEqual(result["detected_schedulers"], ["lsf"])
        self.assertEqual(result["scheduler_status"], "blocked")
        self.assertEqual(self.saved_profile()["scheduler"], "slurm")


if __name__ == "__main__":
    unittest.main()
