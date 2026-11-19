import {createHash, verify, X509Certificate} from 'node:crypto';
import {createReadStream, readFileSync} from 'node:fs';

const publisher = new X509Certificate(readFileSync(new URL('../../contracts/update-publisher.pem', import.meta.url)));
const stable = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const digest = /^[A-Za-z0-9+/]{86}==$/;
export const setupName = version => `AIMatterLab-${version}-win-x64-setup.exe`;
export const maxBlockmap = 8 * 1024 * 1024;
export const publisherThumbprint = publisher.fingerprint.replaceAll(':','');

export function newerRelease(version, current) {
  if (!stable.test(version)) throw Error('Invalid release version');
  const [base, prerelease] = current.split('-');
  if (!stable.test(base)) throw Error('Invalid installed version');
  const next = version.split('.').map(Number), previous = base.split('.').map(Number);
  const different = next.findIndex((value, i) => value !== previous[i]);
  return different === -1 ? Boolean(prerelease) : next[different] > previous[different];
}

// Sign a fixed set of typed fields, independently of YAML whitespace and field order.
export function signingPayload(info) {
  const file = info.files?.[0], map = info.blockMap;
  const validSize = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
  if (!stable.test(info.version) || info.files?.length !== 1 || file?.url !== setupName(info.version) ||
      !validSize(file.size, 2 ** 31) || !digest.test(file.sha512) || !validSize(map?.size, maxBlockmap) ||
      !digest.test(map.sha512) || info.path !== file.url || info.sha512 !== file.sha512) throw Error('Invalid Windows release manifest');
  return Buffer.from(JSON.stringify(['AIMatterLab Windows x64 v1', info.version, file.url, file.size, file.sha512, map.size, map.sha512]));
}

export function readSignedRelease(bytes, publicKey = publisher.publicKey) {
  if (Buffer.byteLength(bytes) > 32 * 1024) throw Error('Release manifest is too large');
  const info = JSON.parse(bytes.toString('utf8'));
  if (typeof info.signature !== 'string' || !verify('sha256', signingPayload(info), publicKey, Buffer.from(info.signature,'base64'))) throw Error('Release signature verification failed');
  return info;
}

export async function fileDigest(file, algorithm = 'sha512', encoding = 'base64') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
