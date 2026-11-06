/** Bounded append-only log buffer split into chunks so old output is not re-rendered. */
export const LOG_LIMIT = 1024 * 1024;

export function appendLogChunks(chunks, text, limit = LOG_LIMIT) {
 if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid log limit');
 if (typeof text !== 'string' || !text) return {chunks: chunks.slice(), truncated: false};
 const next = [...chunks, text];
 let total = next.reduce((sum, value) => sum + value.length, 0);
 let truncated = false;
 while (total > limit && next.length > 1) {
  total -= next.shift().length;
  truncated = true;
 }
 if (total > limit) {
  next[0] = next[0].slice(-limit);
  truncated = true;
 }
 return {chunks: next, truncated};
}

export function logText(chunks) {
 return chunks.join('');
}
