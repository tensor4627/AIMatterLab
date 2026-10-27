export const RPC_METHODS = new Set([
  'account/read', 'account/logout', 'account/login/start', 'account/login/cancel', 'account/rateLimits/read',
  'model/list', 'model/select', 'skills/list', 'thread/list', 'thread/start', 'thread/resume', 'thread/read',
  'turn/start', 'turn/interrupt', 'turn/steer', 'mcpServerStatus/list'
]);
export function assertRpc(method) {
  if (!RPC_METHODS.has(method)) throw new Error('Unsupported Codex method');
}
export function assertWorkerRoute(method, path) {
  const routes = {
    GET: ['/api/environments/drafts','/api/compute/readiness','/api/tools/status','/api/source-projects','/api/source-projects','/api/task-parameters','/api/clusters','/api/cluster-runs','/api/cluster-drafts','/api/health','/api/projects','/api/environments','/api/runs','/api/events','/api/engines','/api/assets','/api/gpu','/api/workflows'],
    POST: ['/api/environments/draft','/api/environments/discover','/api/environments/adopt','/api/custom-cv/read','/api/custom-cv/save','/api/custom-cv/approve-formula','/api/custom-cv/approve-code','/api/custom-cv/sharing','/api/custom-cv/validate','/api/custom-cv/status','/api/custom-cv/reuse','/api/custom-cv/attach','/api/custom-cv/access','/api/custom-cv/provider-read','/api/custom-cv/provider-status','/api/runtime-guide','/api/pygas/catalog','/api/pygas/composition/read','/api/pygas/composition/save','/api/pygas/composition/normalize','/api/pygas/composition/initialize','/api/engine/describe','/api/authoring/context','/api/authoring/adopt','/api/structures/suggest','/api/structures/import-material','/api/source-projects','/api/source-project/inspect','/api/structures/create','/api/pygas/render','/api/source-projects','/api/source-project/inspect','/api/structures/create','/api/pygas/render','/api/cluster/input','/api/cluster/collect','/api/cluster/result','/api/cluster/test','/api/cluster/skill','/api/cluster/browse','/api/cluster/revise','/api/tasks/present','/api/clusters','/api/cluster/profile','/api/cluster/probe','/api/cluster/draft','/api/cluster/prepare','/api/cluster/validate','/api/cluster/submit','/api/cluster/cancel','/api/cluster/status','/api/cluster/log','/api/projects','/api/environments','/api/probe','/api/runs/prepare','/api/inspect',
      '/api/templates/bias','/api/workflows','/api/assets','/api/workspace/read','/api/workspace/write','/api/workspace/materialize','/api/run/validate','/api/run/submit',
      '/api/run/environment-identity','/api/run/cancel','/api/run/status','/api/run/log','/api/run/file','/api/run/collect','/api/run/resume','/api/run/export','/api/run/revise','/api/run/input']
  };
  const target = new URL(path, 'http://127.0.0.1');
  if (target.origin !== 'http://127.0.0.1' || !routes[method]?.includes(target.pathname))
    throw new Error('Unsupported worker route');
}
// The human-only custom-CV controller is intentionally absent from the generic
// renderer request port. Internal typed main actions use assertWorkerRoute instead.
export function assertRendererWorkerRoute(method, path) {
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||/[\r\n\0]/.test(path))throw Error('Use a canonical local worker path');
  const target=new URL(path,'http://127.0.0.1');
  if(target.hash||path!==target.pathname+target.search)throw Error('Ambiguous worker path refused');
  assertWorkerRoute(method,path);
  if(target.pathname==='/api/workspace/materialize')throw Error('Use the typed main-owned human stage; materialization is not a generic renderer tool');
  if(target.pathname==='/api/run/environment-identity')throw Error('Use the main-owned local input review; immutable runtime identity is not a generic renderer tool');
  if(target.pathname.startsWith('/api/custom-cv/'))throw Error('Use the typed human custom CV actions');
  if(target.pathname==='/api/pygas/composition/initialize')throw Error('Use the typed human graph initialization action');
}
export function quoteShell(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'"; }
export function sshAlias(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]{0,200}$/.test(value))
    throw new Error('Choose a valid OpenSSH host alias');
  return value;
}
export function linuxPath(path) {
  if (typeof path !== 'string' || path.includes('\0')) throw new Error('Invalid path');
  if (/^[a-z]:[\\/]/i.test(path))
    return '/mnt/' + path[0].toLowerCase() + '/' + path.slice(3).replaceAll('\\','/');
  if (!path.startsWith('/')) throw new Error('An absolute path is required');
  return path;
}
