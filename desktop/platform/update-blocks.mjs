import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {maxBlockmap} from './update-release.mjs';

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
  return operations;
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw Error('Cannot write update cache');
    offset += bytesWritten;
  }
}

export async function assembleInstaller({operations, source, destination, fetchAsset, size, full, progress}) {
  const buffer = Buffer.allocUnsafe(512 * 1024);
  for (const {remote, start, length} of operations) {
    if (!remote) {
      let copied = 0;
      while (copied < length) {
        const {bytesRead} = await source.read(buffer, 0, Math.min(buffer.length, length - copied), start + copied);
        if (!bytesRead) throw Error('Incomplete base installer');
        await writeAll(destination, buffer.subarray(0,bytesRead));
        copied += bytesRead;
      }
      continue;
    }
    const end = start + length - 1;
    const response = await fetchAsset(full ? {} : {Range:`bytes=${start}-${end}`});
    if (full ? response.status !== 200 : response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
      await response.body?.cancel();
      throw Error('Server did not return the requested installer bytes');
    }
    let received = 0;
    for await (const bytes of response.body) {
      received += bytes.length;
      if (received > length) throw Error('Unexpected extra installer bytes');
      await writeAll(destination, bytes);
      progress(bytes.length);
    }
    if (received !== length) throw Error('Incomplete installer download');
  }
}
