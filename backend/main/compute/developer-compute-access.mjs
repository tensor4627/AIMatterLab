/** The desktop settings owner selects a verified, account-bound remote workspace for developer tests. */
export function developerComputeAccess({workspaceId, userTurn}) {
  const revisions = new Map();
  return {
    allows(scope, candidate) {
      return typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate) &&
        candidate === workspaceId() && !!scope?.threadId && userTurn(scope);
    },
    verifyChange(previous, next, published) {
      if (previous === next || !next) return;
      if (!published.some(item => item.kind === 'ssh' && !item.verificationPending && item.workspace?.workspaceId === next)) {
        throw Error('Select a currently hosted SSH workspace for developer tests');
      }
    },
    changed(previous,next) {
      for (const id of new Set([previous,next])) if (id) revisions.set(id,(revisions.get(id)??0)+1);
    },
    revision(id) { return revisions.get(id)??0; },
  };
}
