import {readFileSync} from 'node:fs';
import {releaseToolSourcePath} from '../../contracts/tools/release-tool-sources.mjs';

export function readReleaseToolSources(file = releaseToolSourcePath) {
  const sources = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(sources) || sources.some(source => typeof source?.name !== 'string' ||
    (source.aliases !== undefined && (!Array.isArray(source.aliases) || source.aliases.some(name => typeof name !== 'string'))))) {
    throw Error('Invalid release tool source catalog');
  }
  return sources;
}
