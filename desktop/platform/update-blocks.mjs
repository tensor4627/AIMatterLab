import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {gunzipSync} from 'node:zlib';
import {maxBlockmap} from './update-release.mjs';

const maxLocalGap = 128 * 1024;
const maxRange = 8 * 1024 * 1024;
const rangeConcurrency = 5;
const rangeAttempts = 3;

export class UpdateTransferError extends Error {}

export async function readBytes(response, limit) {
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw Error('Update response exceeds expected size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

// electron-builder NSIS v2 stores contiguous content-defined blocks for the complete setup.
export function parseBlockmap(bytes, size, expected) {
  if (bytes.length > maxBlockmap || (expected && (bytes.length !== expected.size ||
      createHash('sha512').update(bytes).digest('base64') !== expected.sha512))) throw Error('Block map integrity check failed');
  const map = JSON.parse(gunzipSync(bytes, {maxOutputLength:32 * 1024 * 1024}));
  const file = map.files?.[0];
  if (map.version !== '2' || map.files.length !== 1 || file?.offset !== 0 ||
      !Array.isArray(file.sizes) || !Array.isArray(file.checksums) || file.sizes.length !== file.checksums.length ||
      !file.sizes.length || file.sizes.length > 300000) throw Error('Unsupported block map');
  let offset = 0;
  const blocks = file.sizes.map((length, i) => {
    if (!Number.isSafeInteger(length) || length <= 0 || typeof file.checksums[i] !== 'string' ||
        !/^[A-Za-z0-9+/]{24}$/.test(file.checksums[i])) throw Error('Invalid update block');
    const block = {key:length + ':' + file.checksums[i], length, offset};
    offset += length;
    return block;
  });
  if (offset !== size) throw Error('Block map size mismatch');
  return blocks;
}

export function planBlocks(before, after) {
  const offsets = new Map(before.map(b => [b.key, b.offset]));
  const operations = [];
  for (const block of after) {
    const old = offsets.get(block.key), remote = old === undefined;
    const start = remote ? block.offset : old, last = operations.at(-1);
    if (last?.remote === remote && last.start + last.length === start) last.length += block.length;
    else operations.push({remote, start, length:block.length});
  }
  const plan = [];
  let local = [], gap = 0;
  for (const operation of operations) {
    const {remote, start, length} = operation;
    if (!remote) {
      local.push(operation);
      gap += length;
      continue;
    }
    const last = plan.at(-1);
    // Absorb the local bytes only when the adjacent remote portions fit in one request.
    if (last?.remote && gap <= maxLocalGap && last.length + gap + length <= maxRange) {
      last.length += gap + length;
    } else {
      for (const copy of local) plan.push(copy);
      for (let offset = 0; offset < length; offset += maxRange) {
        plan.push({remote, start:start + offset, length:Math.min(maxRange,length - offset)});
      }
    }
    local = [];
    gap = 0;
  }
  for (const copy of local) plan.push(copy);
  return plan;
}

async function writeAll(handle, bytes, position) {
  let offset = 0;
  while (offset < bytes.length) {
    const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!bytesWritten) throw Error('Cannot write update cache');
    offset += bytesWritten;
  }
}

export async function assembleInstaller({operations, source, destination, fetchAsset, size, full, signal, progress}) {
  let writes = Promise.resolve();
  async function transfer(response, {position,length}, expectedRange, requestSignal, report) {
    const status = full ? 200 : 206;
    if (response.status !== status || (!full && response.headers.get('content-range') !== expectedRange) || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new UpdateTransferError(response.status !== status ? `HTTP ${response.status}` : 'Server did not return the requested installer bytes');
    }
    const hash = full ? createHash('sha512') : undefined;
    const reader = response.body.getReader();
    const cancel = () => reader.cancel().catch(() => {});
    requestSignal.addEventListener('abort',cancel,{once:true});
    let received = 0;
    try {
      for (;;) {
        requestSignal.throwIfAborted();
        const {done,value:bytes} = await reader.read().catch(error => {
          requestSignal.throwIfAborted();
          throw new UpdateTransferError('Installer response was interrupted',{cause:error});
        });
        requestSignal.throwIfAborted();
        if (done) break;
        if (received + bytes.length > length) throw new UpdateTransferError('Unexpected extra installer bytes');
        const target = position + received;
        // Serialize file writes while the other ranges continue reading their responses.
        writes = writes.then(() => {
          requestSignal.throwIfAborted();
          return writeAll(destination,bytes,target);
        });
        await writes;
        requestSignal.throwIfAborted();
        hash?.update(bytes);
        received += bytes.length;
        report(received);
      }
      if (received !== length) throw new UpdateTransferError('Incomplete installer download');
      return hash?.digest('base64');
    } finally {
      requestSignal.removeEventListener('abort',cancel);
      await cancel();
      reader.releaseLock();
    }
  }

  async function download(operation, requestSignal) {
    const {start,length} = operation, end = start + length - 1;
    const headers = full ? {} : {Range:`bytes=${start}-${end}`};
    let credited = 0;
    const report = received => {
      // Retries overwrite the same positions and can only add newly reached bytes.
      if (received <= credited) return;
      progress(received - credited,received - credited);
      credited = received;
    };
    for (let attempt = 1;; attempt++) {
      requestSignal.throwIfAborted();
      try {
        return await fetchAsset(headers,requestSignal,response =>
          transfer(response,operation,`bytes ${start}-${end}/${size}`,requestSignal,report));
      } catch (error) {
        if (full || attempt === rangeAttempts || !(error instanceof UpdateTransferError)) throw error;
        await delay(150 * 2 ** (attempt - 1),undefined,{signal:requestSignal});
      }
    }
  }

  if (full) {
    const fullDownloadSha512 = await download({start:0,position:0,length:size},signal);
    return {fullDownloadSha512};
  }
  const buffer = Buffer.allocUnsafe(512 * 1024), remote = [];
  let position = 0;
  for (const operation of operations) {
    const {start,length} = operation;
    if (operation.remote) remote.push({...operation,position});
    else {
      let copied = 0;
      while (copied < length) {
        signal.throwIfAborted();
        const {bytesRead} = await source.read(buffer,0,Math.min(buffer.length,length - copied),start + copied);
        signal.throwIfAborted();
        if (!bytesRead) throw Error('Incomplete base installer');
        await writeAll(destination,buffer.subarray(0,bytesRead),position + copied);
        copied += bytesRead;
        progress(0,bytesRead);
      }
    }
    position += length;
  }

  const stop = new AbortController(), rangeSignal = AbortSignal.any([signal,stop.signal]);
  let next = 0;
  const workers = Array.from({length:Math.min(rangeConcurrency,remote.length)},async () => {
    while (next < remote.length) await download(remote[next++],rangeSignal);
  });
  try {
    await Promise.all(workers);
    signal.throwIfAborted();
  } catch (error) {
    stop.abort(error);
    await Promise.allSettled(workers);
    throw error;
  }
  return {};
}
