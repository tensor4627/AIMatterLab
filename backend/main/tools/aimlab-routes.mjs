const empty = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw Error('Empty typed request required');
};
const object = (value, keys, required) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('Invalid typed request');
  for (const key of required) if (typeof value[key] !== 'string' || !value[key]) throw Error('Invalid ' + key);
};
const source = value => {
  object(value, ['source_root', 'commit'], ['source_root']);
  return {repo_root: value.source_root, commit: value.commit || 'HEAD'};
};

/** Register only through the desktop's sender-validated privileged handle. */
export function registerAimlabToolSourceRoutes({handle, sources, chooseSourceDirectory}) {
  if (!sources || !['inspect', 'register', 'update', 'list', 'read'].every(name => typeof sources[name] === 'function')) throw Error('AimLab tool source registry required');
  handle('tools.aimlab.choose', async value => {
    empty(value);
    return {source_root: await chooseSourceDirectory()};
  });
  handle('tools.aimlab.sources.inspect', async value => sources.inspect(source(value)));
  handle('tools.aimlab.sources.register', async value => sources.register(source(value)));
  handle('tools.aimlab.sources.update', async value => {
    object(value, ['tool_id', 'source_root', 'commit', 'expected_revision'], ['tool_id', 'source_root']);
    if (!Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1) throw Error('Invalid expected_revision');
    return sources.update({tool_id: value.tool_id, repo_root: value.source_root, commit: value.commit || 'HEAD', expected_revision: value.expected_revision});
  });
  handle('tools.aimlab.sources.list', async value => {
    empty(value);
    return sources.list();
  });
  handle('tools.aimlab.sources.read', async value => {
    object(value, ['tool_id', 'declaration_sha256'], ['tool_id']);
    if (value.declaration_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(value.declaration_sha256)) throw Error('Invalid declaration_sha256');
    return sources.read({tool_id: value.tool_id, declaration_sha256: value.declaration_sha256});
  });
}
