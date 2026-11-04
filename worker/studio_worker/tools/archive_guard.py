"""Read-before-I/O guidance policy from authoritative activation metadata only."""
import os
from pathlib import Path


def canonical(path):
    return os.path.normcase(os.path.abspath(os.path.normpath(str(path))))


def archived_resources(service):
    listing = getattr(service.store, 'list', None)
    if listing is None: return []  # Legacy read-only test harnesses have no activation store.
    activations = {item['configuration_id'] for item in listing('tool-activation')}
    packages = {item['id']: item for item in listing('tool-package-version')}
    aliases = {item['id']: item.get('roots', []) for item in listing('tool-package-alias')}
    result = []; seen = set()
    for configuration in sorted(listing('tool-configuration'), key=lambda item: item['id']):
        # Activation is the durable seal. Later failure/staleness cannot reopen it.
        if configuration['id'] not in activations: continue
        package = next((item for item in packages.values() if item['package_id'] == configuration['package_id'] and item['package_version'] == configuration['package_version']), None)
        if package is None: continue
        manifest = package['manifest']; links = {item['path']: item['target'] for item in package['files'] if item['kind'] == 'symlink'}
        roots = list(dict.fromkeys([package['snapshot_root'], *aliases.get(package['id'], [])]))
        for role in ('delivery', 'installation', 'configuration'):
            for relative in ([manifest['guidance'][role]] if role == 'delivery' else manifest['guidance'][role]):
                resolved = relative
                for _ in range(40):
                    parts = Path(resolved).parts; found = False
                    for index in range(1, len(parts) + 1):
                        prefix = Path(*parts[:index]).as_posix()
                        if prefix in links:
                            resolved = os.path.normpath(str(Path(prefix).parent / links[prefix] / Path(*parts[index:])))
                            found = True; break
                    if not found: break
                for root in roots:
                    for name in dict.fromkeys([relative, resolved]):
                        path = canonical(Path(root) / name)
                        if path in seen: continue
                        seen.add(path); result.append({'path': path, 'role': role, 'package_id': package['package_id'], 'package_version': package['package_version'], 'configuration_id': configuration['id']})
    # Snapshot text readers must not bypass policy through copies of archived inputs.
    original = {item['path']: item for item in result}
    for run in service.store.runs() if hasattr(service.store, 'runs') else []:
        for item in run.get('snapshots', []):
            archived = original.get(canonical(item.get('source', '')))
            if archived:
                for folder in ('simulation', 'results'):
                    result.append({**archived, 'path': canonical(Path(run['directory']) / folder / item['name'])})
    return result


def guidance_read_allowed(service, path):
    selected = canonical(path)
    return not any(item['path'] == selected for item in archived_resources(service))


def assert_guidance_read(service, path):
    if not guidance_read_allowed(service, path): raise PermissionError('Archived tool guidance is unavailable during ordinary execution; use the authoritative execution skill')


def guard_path_before_resolve(service, path):
    """Inspect links themselves only; deny an archived target before its stat/open."""
    blocked = {item['path'] for item in archived_resources(service)}
    pending = list(Path(os.path.abspath(str(path))).parts)
    current = Path(pending.pop(0)); followed = set()
    while pending:
        current = current / pending.pop(0)
        if canonical(current) in blocked: raise PermissionError('Archived tool guidance requires its execution skill')
        if current.is_symlink():
            if current in followed or len(followed) >= 40: raise ValueError('Cyclic read path refused')
            followed.add(current)
            target = Path(os.readlink(current))
            expanded = Path(os.path.abspath(str(target if target.is_absolute() else current.parent / target)))
            complete = expanded.joinpath(*pending)
            if canonical(complete) in blocked or canonical(expanded) in blocked: raise PermissionError('Archived tool guidance requires its execution skill')
            pending = [*expanded.parts[1:], *pending]; current = Path(expanded.anchor)
