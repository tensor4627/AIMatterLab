import fs from 'node:fs';
// Use the packaged application identity for every protocol handshake.
export const STUDIO_VERSION=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
