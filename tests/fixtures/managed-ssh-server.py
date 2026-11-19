"""Two disposable loopback OpenSSH targets. No writes to system configuration or user SSH files."""
import contextlib
import json
import os
import pathlib
import pwd
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


def key(path):
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(path)], check=True)


def stop_fixture_workers(home):
    namespace = home / ".local/state/gpu-sampling-studio/ssh-services"
    if not namespace.is_dir():
        return 0
    stopped = 0
    for process in pathlib.Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            if process.stat().st_uid != os.getuid():
                continue
            command = (process / "cmdline").read_bytes()
            argv = command.decode().rstrip("\0").split("\0")
            if len(argv) != 7 or argv[1:4] != ["-m", "studio_worker.server", "--root"] or argv[5] != "--port":
                continue
            root = pathlib.Path(argv[4])
            if root.parent != namespace or not (root / "ssh-service.json").is_file():
                continue
            pidfd = os.pidfd_open(int(process.name))
            try:
                if (process / "cmdline").read_bytes() != command:
                    continue
                signal.pidfd_send_signal(pidfd, signal.SIGTERM)
                if not select.select([pidfd], [], [], 2)[0]:
                    signal.pidfd_send_signal(pidfd, signal.SIGKILL)
                    if not select.select([pidfd], [], [], 2)[0]:
                        raise RuntimeError("Fixture-owned worker did not stop")
                stopped += 1
            finally:
                os.close(pidfd)
        except (FileNotFoundError, ProcessLookupError, PermissionError, UnicodeError):
            continue
    return stopped


def fixture_server(path, authorized, server, env, cleanup):
    path.mkdir(mode=0o700)
    key(path / "host")
    (path / "authorized_keys").write_text(authorized)
    (path / "authorized_keys").chmod(0o600)
    with socket.socket() as port_probe:
        port_probe.bind(("127.0.0.1", 0))
        port = port_probe.getsockname()[1]
    username = pwd.getpwuid(os.getuid()).pw_name
    home = path / "home"
    home.mkdir(mode=0o700)
    tools = path / "fixture-bin"
    tools.mkdir(mode=0o700)
    commands = {
        "sinfo": "printf '%s\\n' 'fixture-only|up|1|idle|gpu:1'",
        "sbatch": "echo once >> \"$HOME/submissions\"; echo 4242",
        "squeue": "exit 0", "sacct": "exit 0", "bqueues": "exit 1",
    }
    for name, command in commands.items():
        program = tools / name
        program.write_text("#!/bin/sh\n" + command + "\n")
        program.chmod(0o700)
    # Bash login and noninteractive worker commands both see the owned scheduler fixtures.
    fixture_env = path / "fixture-env"
    fixture_env.write_text("export PATH=" + str(tools) + ":$PATH\nexport HOME=" + str(home) + "\n")
    (home / "run.py").write_text("print('standalone scheduler fixture')\n")
    shell = path / "shell"
    shell.write_text("#!/bin/sh\nexport HOME=" + str(home) + "\nexport HISTFILE=/dev/null SHELL=/bin/bash\n"
                     "export BASH_ENV=" + str(fixture_env) + "\n. \"$BASH_ENV\"\n"
                     "cd \"$HOME\" || exit 1\nif [ -n \"$SSH_ORIGINAL_COMMAND\" ]; then exec /bin/sh -c \"$SSH_ORIGINAL_COMMAND\"; fi\n"
                     "exec /bin/bash --noprofile --norc -i\n")
    shell.chmod(0o700)
    config = path / "sshd_config"
    config.write_text("\n".join(["ListenAddress 127.0.0.1", f"Port {port}", f"HostKey {path}/host",
        f"PidFile {path}/pid", f"AuthorizedKeysFile {path}/authorized_keys", f"AllowUsers {username}",
        "PermitRootLogin prohibit-password", "PasswordAuthentication no", "KbdInteractiveAuthentication no",
        "PubkeyAuthentication yes", "UsePAM no", "StrictModes yes", "MaxSessions 8", "AllowTcpForwarding no",
        "X11Forwarding no", "PrintMotd no", "PrintLastLog no", f"ForceCommand {shell}", "LogLevel VERBOSE"]) + "\n")
    log = cleanup.enter_context((path / "server.log").open("wb"))
    subprocess.run([server, "-t", "-f", str(config)], env=env, check=True)
    process = subprocess.Popen([server, "-D", "-e", "-f", str(config)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env)
    def stop():
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    cleanup.callback(stop)
    cleanup.callback(stop_fixture_workers, home)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError((path / "server.log").read_text()[-1000:])
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.2) as connection:
                if connection.recv(200).startswith(b"SSH-2.0-"):
                    break
        except OSError:
            time.sleep(.05)
    else:
        raise RuntimeError("Loopback fixture did not start")
    public = " ".join((path / "host.pub").read_text().split()[:2])
    return {"port":port, "username":username, "known":f"[127.0.0.1]:{port} {public}\n", "home":str(home)}


def fixture_local_worker(root, source, cleanup):
    runtime = pathlib.Path(source).resolve(strict=True)
    if not (runtime / "studio_worker/server.py").is_file():
        raise RuntimeError("Expected the local AIMatterLab worker source")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = cleanup.enter_context((root.parent / "local-worker.log").open("wb"))
    env = {k: v for k, v in os.environ.items() if k != "STUDIO_SSH_SERVICE_ROOT"}
    env.update(PYTHONPATH=str(runtime), PYTHONDONTWRITEBYTECODE="1")
    child = subprocess.Popen([sys.executable, "-m", "studio_worker.server", "--root", str(root), "--port", str(port)],
                             env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)

    def stop():
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        return child.returncode is not None

    cleanup.callback(stop)
    for _ in range(100):
        if child.poll() is not None:
            break
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.2):
                return {"root": str(root), "runtime": str(runtime), "port": port}, stop
        except OSError:
            time.sleep(.05)
    raise RuntimeError("Disposable local worker did not bind its loopback listener")


def main():
    request = json.loads(sys.stdin.readline())
    if request.get("workerSource") and subprocess.run(["/bin/bash", "-lc", "command -v sbatch || command -v bsub"],
                                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        raise RuntimeError("Use a disposable local distribution without a system scheduler for the submission fixture")
    server = request.get("server") or shutil.which("sshd")
    if not server or not pathlib.Path(server).is_file():
        raise RuntimeError("An installed or explicitly supplied test sshd is required")
    env = os.environ.copy()
    if request.get("library"):
        env["LD_LIBRARY_PATH"] = request["library"]
    # OpenSSH verifies ownership up to the account home. A key under /tmp crosses a world-writable parent.
    with tempfile.TemporaryDirectory(prefix=".aimatter-test-sshd-", dir=pwd.getpwuid(os.getuid()).pw_dir) as folder, contextlib.ExitStack() as cleanup:
        root = pathlib.Path(folder)
        key(root / "client")
        authorized = (root / "client.pub").read_text() + request["publicKey"].strip() + "\n"
        targets = [fixture_server(root / label, authorized, server, env, cleanup) for label in ("a","b")]
        known = root / "known_hosts"
        known.write_text("".join(row["known"] for row in targets))
        local, stop_local = fixture_local_worker(root / "local-worker", request["workerSource"], cleanup) if request.get("workerSource") else (None, lambda: None)
        print(json.dumps({"targets":targets,"identity":str(root/"client"),"known":str(known),"local":local}), flush=True)
        sys.stdin.readline()
        workers = [stop_fixture_workers(pathlib.Path(item["home"])) for item in targets]
        counts = [(root / name / "server.log").read_text().count("Accepted publickey for") for name in ("a","b")]
        logs = [(root / name / "server.log").read_text() for name in ("a","b")]
        conditions = ["bad ownership", "Connection from", "Accepted key", "Failed publickey", "account is locked", "Connection closed", "Disconnected", "session: forced-command"]
        print(json.dumps({"authentications":counts, "workersStopped":workers, "localWorkerStopped":stop_local(), "observations":[{key:log.count(key) for key in conditions if key in log} for log in logs]}), flush=True)


if __name__ == "__main__":
    main()
