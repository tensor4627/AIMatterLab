import {readBytes} from './update-blocks.mjs';

const gitlab = 'https://git.nju.edu.cn/api/v4/projects/Tensor4627%2FAIMatterLab/releases/';
const github = 'https://api.github.com/repos/tensor4627/AIMatterLab/releases/';
const githubPublic = 'https://github.com/tensor4627/AIMatterLab/releases/';
export const updateSources = ['nju','github'];
export const sourceName = source => source === 'nju' ? 'NJU GitLab' : 'GitHub';

export function validateUpdateSource(source) {
  if (!updateSources.includes(source)) throw Error('Unknown update source');
  return source;
}

export function createUpdateAccess(vault) {
  const status = () => Object.fromEntries(updateSources.map(source => [source,vault.has(source)]));
  function save(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'source,token') throw Error('Invalid update access request');
    const source = validateUpdateSource(input.source);
    if (input.token === null) vault.remove(source);
    else {
      if (typeof input.token !== 'string' || !/^[!-~]{1,512}$/.test(input.token)) throw Error('Invalid release access token');
      vault.put(source,input.token);
    }
    return status();
  }
  return {status,save,token:source => vault.get(validateUpdateSource(source))};
}

export function createUpdateFeeds({fetchApi, tokenFor = () => null, signal}) {
  const githubReleases = new Map();
  // Follow redirects explicitly so private headers never reach an asset-storage host.
  async function request(address, headers, auth, timeout) {
    const deadline = AbortSignal.any([signal,AbortSignal.timeout(timeout)]);
    let url = new URL(address);
    for (let attempt = 0; attempt < 8; attempt++) {
      if (url.protocol !== 'https:' || url.username || url.password) throw Error('Invalid update redirect');
      let response;
      try {
        response = await fetchApi(url.href,{headers:{...headers,...auth},redirect:'manual',
          credentials:'omit',cache:'no-store',signal:deadline});
      } catch {
        throw Error(deadline.aborted ? 'Update request timed out or was interrupted' : 'Update server is unreachable');
      }
      if (![301,302,303,307,308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('Missing update redirect');
      const next = new URL(location,url);
      if (next.origin !== url.origin) auth = {};
      url = next;
    }
    throw Error('Too many update redirects');
  }
  async function asset(source, version, name, headers = {}, timeout = 15000) {
    validateUpdateSource(source);
    const token = tokenFor(source);
    if (source === 'nju') {
      const tag = version ? 'v'+encodeURIComponent(version) : 'permalink/latest';
      return request(gitlab+tag+'/downloads/'+encodeURIComponent(name),headers,token ? {'PRIVATE-TOKEN':token} : {},timeout);
    }
    if (!token) {
      const tag = version ? 'download/v'+encodeURIComponent(version) : 'latest/download';
      return request(githubPublic+tag+'/'+encodeURIComponent(name),headers,{},timeout);
    }
    const auth = {Authorization:'Bearer '+token};
    const tag = version ? 'tags/v'+encodeURIComponent(version) : 'latest';
    let assets = githubReleases.get(tag);
    if (!assets) {
      const response = await request(github+tag,{Accept:'application/vnd.github+json'},auth,15000);
      if (!response.ok) return response;
      const info = JSON.parse((await readBytes(response,1024*1024)).toString('utf8'));
      if (info.draft || info.prerelease || !Array.isArray(info.assets) ||
          (version && info.tag_name !== 'v'+version)) throw Error('Invalid GitHub release');
      assets = new Map(info.assets.filter(file => Number.isSafeInteger(file.id) && file.id > 0).map(file => [file.name,file.id]));
      githubReleases.set(tag,assets);
      githubReleases.set('tags/'+info.tag_name,assets);
    }
    const id = assets.get(name);
    return id ? request(github+'assets/'+id,{...headers,Accept:'application/octet-stream'},auth,timeout) : new Response(null,{status:404});
  }
  return {asset,clear:() => githubReleases.clear()};
}
