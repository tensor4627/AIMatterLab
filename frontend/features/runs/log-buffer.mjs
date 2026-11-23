/** Bounded append-only log buffer split into chunks so old output is not re-rendered. */
export const LOG_LIMIT = 1024 * 1024;

export function appendLogChunks(chunks, text, limit = LOG_LIMIT) {
 if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid log limit');
 if (typeof text !== 'string' || !text) return {chunks: chunks.slice(), truncated: false};
 const next = [...chunks, text];
 let excess = next.reduce((sum, value) => sum + value.length, 0) - limit;
 if (excess <= 0) return {chunks: next, truncated: false};
 let first = 0, precedingCodeUnit = NaN;
 while (next[first].length <= excess) {
  const chunk = next[first++];
  if (chunk.length) precedingCodeUnit = chunk.charCodeAt(chunk.length - 1);
  excess -= chunk.length;
 }
 const chunk = next[first];
 const before = excess ? chunk.charCodeAt(excess - 1) : precedingCodeUnit;
 const after = chunk.charCodeAt(excess);
 // If the boundary splits a surrogate pair, drop the remaining half as well.
 if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) excess++;
 if (excess === chunk.length) return {chunks: next.slice(first + 1), truncated: true};
 const retained = next.slice(first);
 if (excess) retained[0] = chunk.slice(excess);
 return {chunks: retained, truncated: true};
}

export function logText(chunks) {
 return chunks.join('');
}
