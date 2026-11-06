// Renderer-owned navigation helper: observation events must not overwrite a
// project the human selected explicitly.
export function followedProjectId(currentProjectId, previousConversationProjectId, nextConversationProjectId) {
  if (!nextConversationProjectId) return currentProjectId;
  if (!currentProjectId || currentProjectId === previousConversationProjectId) return nextConversationProjectId;
  return currentProjectId;
}
