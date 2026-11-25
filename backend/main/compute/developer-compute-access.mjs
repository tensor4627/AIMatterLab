/** Before approval modes, a stored workspace selection meant developer access. */
export function agentApprovalMode(settings) {
  const mode = settings?.agentApprovalMode;
  if (mode === undefined && settings?.developerComputeWorkspaceId) return 'full';
  return mode === 'auto' || mode === 'full' ? mode : 'manual';
}

const workspaceKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** The desktop owns this preference. Callers establish the underlying tool or lease authority. */
export function developerComputeAccess({workspaceId, userTurn, mode = () => workspaceId() ? 'full' : 'manual'}) {
  const revisions = new Map();
  let approvalRevision = 0;
  function approvalMode(scope, candidate) {
    const current = mode();
    if (!workspaceKey(candidate) || !scope?.threadId || !userTurn(scope)) return 'manual';
    if (current === 'auto') return 'auto';
    return current === 'full' && candidate === workspaceId() ? 'full' : 'manual';
  }
  return {
    approvalMode,
    allows: (scope, candidate) => approvalMode(scope, candidate) === 'full',
    verifyChange(previous, next, published) {
      if (previous === next || !next) return;
      if (!published.some(item => item.kind === 'ssh' && !item.verificationPending && item.workspace?.workspaceId === next)) {
        throw Error('Select a currently hosted SSH workspace for developer tests');
      }
    },
    changed(previous,next,{modeChanged=false}={}) {
      if (modeChanged) approvalRevision++;
      for (const id of new Set([previous,next])) if (id) revisions.set(id,(revisions.get(id)??0)+1);
    },
    revision(id) { return approvalRevision + (revisions.get(id)??0); },
  };
}
