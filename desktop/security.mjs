export const RPC_METHODS = new Set([
  'account/read', 'account/login/start', 'account/login/cancel', 'account/rateLimits/read',
  'model/list', 'model/select', 'skills/list', 'thread/list', 'thread/start', 'thread/resume', 'thread/read',
  'turn/start', 'turn/interrupt', 'turn/steer', 'mcpServerStatus/list'
]);
export function assertRpc(method) {
  if (!RPC_METHODS.has(method)) throw new Error('Unsupported Codex method');
}
export function assertWorkerRoute(method, path) {
  const routes = {
    GET: ['/api/health','/api/projects','/api/environments','/api/runs','/api/events','/api/engines','/api/assets','/api/gpu','/api/workflows'],
    POST: ['/api/projects','/api/environments','/api/probe','/api/runs/prepare','/api/inspect',
      '/api/templates/bias','/api/workflows','/api/assets','/api/workspace/write','/api/run/validate','/api/run/submit',
      '/api/run/cancel','/api/run/status','/api/run/log','/api/run/file','/api/run/collect','/api/run/resume','/api/run/export','/api/run/revise','/api/run/input']
  };
  const target = new URL(path, 'http://127.0.0.1');
  if (target.origin !== 'http://127.0.0.1' || !routes[method]?.includes(target.pathname))
    throw new Error('Unsupported worker route');
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
