// Bounded JSONL framing for provider child stdout.
// `readline` buffers a line without a bound before any per-line guard can run, so
// providers feed raw chunks here instead: a single oversized frame is rejected
// without ever materializing more than maxBytes plus the current chunk.
export function createJsonlFramer({onFrame, onOversize, maxBytes = 1048576} = {}) {
  if (typeof onFrame !== 'function') throw new Error('JSONL framer requires an onFrame handler');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid JSONL frame bound');
  let buffer = Buffer.alloc(0);
  function emit(line) {
    let text = line.toString('utf8');
    if (text.endsWith('\r')) text = text.slice(0, -1);
    if (text) onFrame(text);
  }
  return {
    get bufferedBytes() { return buffer.length; },
    reset() { buffer = Buffer.alloc(0); },
    feed(chunk) {
      if (!chunk || !chunk.length) return;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) {
          if (buffer.length > maxBytes) {
            const oversized = buffer.length;
            buffer = Buffer.alloc(0);
            onOversize?.(oversized);
          }
          return;
        }
        const line = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        if (line.length > maxBytes) { onOversize?.(line.length); continue; }
        emit(line);
      }
    },
  };
}
