import {readFileSync} from 'node:fs';

export const releaseToolSourcePath = new URL('../../installation/tool-sources.json', import.meta.url);

export function readReleaseToolSources(file = releaseToolSourcePath) {
  const sources = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(sources) || sources.some(source => typeof source?.name !== 'string' ||
    (source.aliases !== undefined && (!Array.isArray(source.aliases) || source.aliases.some(name => typeof name !== 'string'))))) {
    throw Error('Invalid release tool source catalog');
  }
  return sources;
}

export function releaseToolNames(source) {
  return [...new Set([source.name, ...source.name.split('/').map(name => name.trim()), ...(source.aliases || [])])];
}

export function releaseToolNameKey(value) {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

export function createReleaseToolMatcher(sources) {
  const aliases = sources.flatMap(source => releaseToolNames(source).map(name => ({source, name})))
    .sort((a, b) => b.name.length - a.name.length);
  if (!aliases.length) return () => undefined;
  const alternatives = aliases.map(({name}) => name.split(/[\s_-]+/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]*'));
  const pattern = new RegExp('(?<![a-z0-9_])(' + alternatives.join('|') + ')(?![a-z0-9_])', 'i');
  const byName = new Map(aliases.map(({name, source}) => [releaseToolNameKey(name), source]));
  return text => {
    const match = pattern.exec(text);
    if (!match) return undefined;
    return {source: byName.get(releaseToolNameKey(match[0])), text: text.slice(0, match.index) + '@' + text.slice(match.index + match[0].length)};
  };
}
