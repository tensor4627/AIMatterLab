"""Bounded existing-machine discovery. Registration is a desktop action, never a grant."""
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path


INSPECT = r'''
import importlib.util,json,sys
modules={}
for name in ('ase','numpy','torch','cupy','pydyn','hotpp','base'):
 try:
  spec=importlib.util.find_spec(name)
  modules[name]={'available':spec is not None,'origin':spec.origin if spec else None}
 except Exception:modules[name]={'available':False}
cuda={}
for name in ('torch','cupy'):
 if not modules[name]['available']:continue
 try:
  module=__import__(name)
  count=module.cuda.device_count() if name=='torch' else module.cuda.runtime.getDeviceCount()
  cuda[name]={'available':count>0,'device_count':count,'version':str(module.__version__)}
 except Exception as exc:cuda[name]={'available':False,'error_type':type(exc).__name__}
print('__STUDIO_COMPUTE__'+json.dumps({'python':sys.executable,'version':sys.version.split()[0],'modules':modules,'cuda':cuda}))
'''


def signature(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def candidates(service):
    """Explicit registrations, PATH, standard venv indexes; no recursive home scan."""
    result = [];seen=set()
    def add(value):
        if not value or len(result) >= 24:return
        path = Path(value).expanduser()
        if path.is_absolute() and path.is_file() and os.access(path, os.X_OK):
            key=str(path.parent.parent) if (path.parent.parent/'pyvenv.cfg').is_file() else str(path.resolve())
            if key not in seen:seen.add(key);result.append(str(path))  # Preserve venv symlink semantics.
    for environment in service.store.list('environment'):
        add(environment.get('executables', {}).get('python'))
    add(shutil.which('python'));add(sys.executable);add(shutil.which('python3'))
    home = Path.home()
    index = home/'.conda/environments.txt'
    if index.is_file() and index.stat().st_size <= 65536:
        for line in index.read_text(errors='replace').splitlines()[:64]:add(Path(line)/'bin/python')
    for root in (home/'.venvs', home/'venvs', home/'.virtualenvs', home/'miniconda3', home/'anaconda3', home/'miniforge3', home/'mambaforge', home/'.local/share/mamba', Path('/opt/conda'), Path('/opt/miniconda3')):
        add(root/'bin/python')
        directory = root if root.name in ('.venvs', 'venvs', '.virtualenvs') else root/'envs'
        if directory.is_dir():
            for child in sorted(directory.iterdir())[:32]:add(child/'bin/python')
    for source in service.store.list('source-project'):
        root=Path(source['root'])
        for relative in ('.venv/bin/python','venv/bin/python'):add(root/relative)
    # Only inspect immediate venv markers in managed/common prefixes, never recurse.
    for root in (service.root,home/'.local/state/gpu-sampling-studio',home):
        if root.is_dir():
            for child in sorted(root.iterdir())[:128]:
                if child.is_dir() and (child/'pyvenv.cfg').is_file():add(child/'bin/python')
    return result


def native_paths(service):
    result={}
    for name in ('gpumd','gpu-sampling','nep'):
        found=shutil.which(name)
        if found:result[name]=found
    for source in service.store.list('source-project'):
        if source['id']!='gpumd':continue
        for name in ('gpumd','gpu-sampling','nep'):
            for relative in (name, 'src/'+name, 'bin/'+name):
                file=Path(source['root'])/relative
                if name not in result and file.is_file() and os.access(file,os.X_OK):result[name]=str(file)
    return result


def discover(service, force=False):
    with service.compute_setup_lock:
        return _discover(service, force)


def _discover(service, force=False):
    if not isinstance(force,bool):raise ValueError('force must be boolean')
    paths=candidates(service);native=native_paths(service)
    sources={s['id']:s['root'] for s in service.store.list('source-project') if s['id'] in ('pydyn','pygas','hotpp')}
    identity=signature({'python':[(p,os.stat(p).st_mtime_ns,os.stat(p).st_size) for p in paths], 'native':[(k,v,os.stat(v).st_mtime_ns) for k,v in sorted(native.items())], 'sources':sources})
    prior=next(iter(service.store.list('compute-discovery')),None)
    if not force and prior and prior.get('identity')==identity and time.time()-prior['observed_at']<86400:
        return {**prior,'cached':True}
    entries=[];started=time.monotonic()
    for python in paths:
        if time.monotonic()-started>100:
            entries.append({'python':python,'status':'not_run','reason':'Discovery time budget reached'});continue
        try:
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'}
            # New registrations may reuse explicitly bound source roots; existing
            # environment registrations are never rewritten or switched.
            env['PYTHONPATH']=os.pathsep.join(sources.values())
            output=subprocess.run([python,'-c',INSPECT],env=env,capture_output=True,text=True,timeout=30)
            line=next((line for line in output.stdout.splitlines() if line.startswith('__STUDIO_COMPUTE__')),None)
            if output.returncode or not line:raise ValueError('Interpreter could not return its discovery receipt')
            observed=json.loads(line.removeprefix('__STUDIO_COMPUTE__'))
            modules=observed['modules'];scientific=any(modules[name]['available'] for name in ('ase','pydyn','hotpp','base'))
            if not scientific:
                entries.append({'python':python,'status':'blocked','reason':'No supported scientific packages found','observation':observed});continue
            # Sources are recorded only from the actual installed/importable module origin.
            repositories={}
            for name,module in (('pydyn','pydyn'),('pygas','base'),('hotpp','hotpp')):
                origin=modules[module].get('origin')
                if origin and Path(origin).is_file():repositories[name]=str(Path(origin).resolve().parent.parent)
            variables={}
            torch_origin=modules['torch'].get('origin')
            if torch_origin:
                site=Path(torch_origin).parent.parent
                libraries=[Path(torch_origin).parent/'lib']
                if (site/'nvidia').is_dir():libraries.extend(sorted((site/'nvidia').glob('*/lib'))[:32])
                libraries=[str(p) for p in libraries if p.is_dir()]
                if libraries:variables['LD_LIBRARY_PATH']=os.pathsep.join(libraries+([os.environ['LD_LIBRARY_PATH']] if os.environ.get('LD_LIBRARY_PATH') else []))
            spec={'name':'WSL · '+Path(python).parent.parent.name,'executables':{'python':python,**native},'repositories':repositories,'variables':variables}
            key=signature(spec)
            entries.append({'id':key,'python':python,'python_stat':[os.stat(python).st_mtime_ns,os.stat(python).st_size],'status':'discovered','spec':spec,'observation':observed,'scientific_status':'not_run'})
        except (OSError,ValueError,subprocess.TimeoutExpired,KeyError,TypeError) as exc:
            entries.append({'python':python,'status':'blocked','reason':'Interpreter discovery failed','error_type':type(exc).__name__})
    receipt={'id':'local','identity':identity,'observed_at':time.time(),'entries':entries,'status':'observed','cached':False,'scope':'Existing software and actual Python CUDA availability only. Engine/artifact checks and scientific runs are separate; no installation or project authorization changes.'}
    service.store.put('compute-discovery',receipt)
    return receipt


def adopt(service, data):
    receipt=next(iter(service.store.list('compute-discovery')),None)
    if not receipt or data.get('identity')!=receipt['identity']:raise ValueError('Discovery changed; read the current discovery before registering')
    selected=data.get('candidates')
    if not isinstance(selected,list) or not selected or len(selected)>24 or any(not isinstance(key,str) for key in selected):raise ValueError('Select discovered candidate identities')
    by_id={entry['id']:entry for entry in receipt['entries'] if entry.get('status')=='discovered'}
    if any(key not in by_id for key in selected):raise ValueError('Unknown discovery candidate')
    result=[]
    with service.store.lock:
        current_receipt=next(iter(service.store.list('compute-discovery')),None)
        if current_receipt!=receipt:raise ValueError('Discovery changed during registration; read current candidates')
        existing=service.store.list('environment')
        for key in dict.fromkeys(selected):
            item=by_id[key];spec=json.loads(json.dumps(item['spec']))
            python=Path(item['python'])
            if not python.is_file() or item['python_stat']!=[python.stat().st_mtime_ns,python.stat().st_size]:raise ValueError('Discovered interpreter changed; discover again')
            launchers=[]
            if item.get('observation',{}).get('modules',{}).get('hotpp',{}).get('available'):launchers.append(('hotpp','hotpp.entrypoints.main'))
            pygas=spec.get('repositories',{}).get('pygas')
            if pygas and (Path(pygas)/'entrypoints/cli.py').is_file():launchers.append(('pygas','entrypoints.cli'))
            for name,module in launchers:
                # HotPP's public Python module is an installed CLI even when a
                # console script was not placed on PATH. Keep its shim private
                # to this registration; never modify the source or global PATH.
                parent=service.root/'environment-launchers';folder=parent/key
                if parent.is_symlink() or folder.is_symlink():raise ValueError('Linked launcher directory refused')
                folder.mkdir(parents=True,exist_ok=True)
                target=folder/name
                body='#!/bin/sh\nexec '+shlex.quote(str(python))+' -m '+module+' "$@"\n'
                if target.is_symlink():raise ValueError('Linked launcher refused')
                if target.exists():
                    if target.read_text()!=body:raise ValueError('Registered launcher changed; use a new registration')
                else:
                    with target.open('x') as stream:stream.write(body)
                    target.chmod(0o700)
                spec['executables'][name]=str(target)
            # Never overwrite a manually registered environment or switch its source tree.
            match=next((env for env in existing if all(env.get(k,{})==spec.get(k,{}) for k in ('executables','repositories','variables'))),None)
            if match:
                service.store.put('environment-observation',{'id':match['id'],'configuration':signature({key:match.get(key,{}) for key in ('executables','repositories','variables')}),'observed_at':receipt['observed_at'],'observation':item['observation']})
                result.append(match);continue
            # Include derived CLI capabilities in the registration identity, so
            # an older auto-registration is preserved when a new shim is added.
            identifier='auto-wsl-'+signature(spec)[:16]
            if any(env['id']==identifier for env in existing):raise ValueError('Automatic registration identity conflict')
            value=service.register_environment({**spec,'id':identifier,'version':1,'discovery':{'observed_at':receipt['observed_at'],'identity':key,'observation':item['observation'],'scientific_status':'not_run'}})
            existing.append(value);result.append(value)
    return {'environments':result,'scope':'Added explicit versioned registrations only. Existing environments, project authorization and jobs unchanged.'}


def readiness(service):
    from studio_worker.compute.cluster import public
    environments=[]
    for env in service.store.list('environment'):
        discovery=env.get('discovery') or {}
        sidecar=next((entry for entry in service.store.list('environment-observation') if entry['id']==env['id']),None)
        if sidecar and sidecar['configuration']==signature({key:env.get(key,{}) for key in ('executables','repositories','variables')}):discovery=sidecar
        observed=discovery.get('observation',{})
        environments.append({'id':env['id'],'name':env['name'],'executables':env.get('executables',{}),'repositories':env.get('repositories',{}),'discovery':discovery, 'cuda':observed.get('cuda',{}),'scientific_status':'not_run'})
    return {'environments':environments,'clusters':[public(p) for p in service.store.list('cluster')],'discovery':next(iter(service.store.list('compute-discovery')),None),'scope':'Registration and last observed discovery only; use exact-engine probe_environment/read_runtime_guide before deployment. No jobs submitted.'}


def draft(service, proposal):
    from studio_worker.tools.adapters import process_env
    if not isinstance(proposal,dict) or set(proposal)-{'name','executables','repositories','variables'}:raise ValueError('Only environment paths and loader settings may be proposed')
    name=proposal.get('name')
    if not isinstance(name,str) or not name.strip() or len(name)>120:raise ValueError('Environment name required')
    for key,allowed in (('executables',{'python','gpumd','gpu-sampling','nep','hotpp','pygas'}),('repositories',{'pydyn','pygas','hotpp','hotham','gpumd'})):
        values=proposal.get(key,{})
        if not isinstance(values,dict) or set(values)-allowed:raise ValueError('Unsupported environment path keys')
        if any(not isinstance(path,str) or len(path)>4096 or not path.startswith('/') or any(c in path for c in ('\n','\r','\0')) for path in values.values()):raise ValueError('Absolute Linux environment paths required')
    if not proposal.get('executables',{}).get('python'):raise ValueError('Python path required')
    if not isinstance(proposal.get('variables',{}),dict):raise ValueError('Loader variables must be an object')
    process_env(proposal)  # Allow only the same bounded loader variables as real runs.
    key='setup-'+signature(proposal)[:20]
    previous=next((value for value in service.store.list('environment-draft') if value['id']==key),None)
    if previous:return previous
    return service.store.put('environment-draft',{'id':key,'proposal':proposal,'status':'draft','created_at':time.time(),'scope':'Review in Compute environments and save. No registration, installation, grant or execution.'})
