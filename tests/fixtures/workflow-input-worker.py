"""Isolated real worker for file-ingestion and preparation tests. No jobs run."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend' / 'worker'))
from studio_worker.server import dispatch
from studio_worker.service import Service


with tempfile.TemporaryDirectory(prefix='studio-input-fixture-') as directory:
    base = Path(directory)
    service = Service(base / 'worker', schedule=False)
    project_id = 'source-fixture'
    root = service.root / 'projects' / project_id / 'inputs'
    root.mkdir(parents=True)
    remote = base / 'existing remote' / 'selected potential.txt'
    remote.parent.mkdir()
    remote.write_text('nep4 1 H\n', encoding='utf-8')
    environment = service.register_environment({'name':'Fixture', 'executables':{'gpumd':sys.executable, 'python':sys.executable}})
    project = service.register_project({'id':project_id, 'name':'Fixture', 'policy':{
        'input_roots':[str(root)], 'environments':[environment['id']], 'engines':['gpumd.md']}})
    print(json.dumps({'root':str(service.root), 'inputRoot':str(root), 'remote':str(remote), 'project':project,
                      'environment':environment['id']}), flush=True)
    try:
        for line in sys.stdin:
            value = json.loads(line)
            try:
                result = dispatch(service, value['method'], value['route'], value.get('data', {}), value.get('admin', True))
                reply = {'result':result}
            except Exception as error:
                reply = {'error':str(error)}
            print(json.dumps(reply), flush=True)
    finally:
        service.close()
        service.store.db.close()
