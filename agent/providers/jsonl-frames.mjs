import {attachmentLimits} from '../../contracts/agent/chat-attachments.mjs';

// Native protocols can echo an entire user turn. The bound covers a full
// attachment budget encoded as base64, plus text and the JSON-RPC envelope.
export const ATTACHMENT_FRAME_BYTES=attachmentLimits.totalBytes*1.5;

// Bounded JSONL framing for provider child stdout.
// `readline` buffers a line without a bound before any per-line guard can run, so
// providers feed raw chunks here instead: a single oversized frame is rejected
// without ever materializing more than maxBytes plus the current chunk.
export function createJsonlFramer({onFrame, onOversize, maxBytes = 1048576} = {}) {
  if (typeof onFrame !== 'function') throw new Error('JSONL framer requires an onFrame handler');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid JSONL frame bound');
  let pending = [], bytes = 0;
  function reset() { pending = []; bytes = 0; }
  function emit(line) {
    let text = line.toString('utf8');
    if (text.endsWith('\r')) text = text.slice(0, -1);
    if (text) onFrame(text);
  }
  return {
    get bufferedBytes() { return bytes; },
    reset,
    feed(chunk) {
      if (!chunk || !chunk.length) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < buffer.length) {
        const newline = buffer.indexOf(10, offset);
        const part = buffer.subarray(offset, newline < 0 ? buffer.length : newline);
        const length = bytes + part.length;
        if (length > maxBytes) {
          reset();
          onOversize?.(length);
        } else if (newline < 0) {
          pending.push(Buffer.from(part));
          bytes = length;
        } else {
          const line = bytes ? Buffer.concat([...pending, part], length) : part;
          reset();
          emit(line);
        }
        if (newline < 0) return;
        offset = newline + 1;
      }
    },
  };
}
