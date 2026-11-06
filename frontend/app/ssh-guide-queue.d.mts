export function sshGuideKey(request: Record<string, unknown>): string;
export function enqueueSshGuide<T>(current: T | null, queued: T | null, next: T): {current: T | null; queued: T | null};
export function takeQueuedSshGuide<T>(current: T | null, queued: T | null): {current: T | null; queued: T | null};
