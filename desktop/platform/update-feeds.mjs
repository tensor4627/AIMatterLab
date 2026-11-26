import {readBytes, UpdateTransferError} from './update-blocks.mjs';

const gitlab = 'https://git.nju.edu.cn/api/v4/projects/Tensor4627%2FAIMatterLab/releases/';
const github = 'https://api.github.com/repos/tensor4627/AIMatterLab/releases/';
const githubPublic = 'https://github.com/tensor4627/AIMatterLab/releases/';
export const updateSources = ['github','nju'];
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
  async function request(address, headers, auth, timeout, requestSignal, onRedirected) {
    const deadline = AbortSignal.any([requestSignal,AbortSignal.timeout(timeout)]);
    let url = new URL(address);
    const origin = url.origin;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (url.protocol !== 'https:' || url.username || url.password) throw new UpdateTransferError('Invalid update redirect');
      let response;
      try {
        deadline.throwIfAborted();
        response = await fetchApi(url.href,{headers:{...headers,...auth},redirect:'manual',
          credentials:'omit',cache:'no-store',signal:deadline});
      } catch {
        throw new UpdateTransferError(deadline.aborted ? 'Update request timed out or was interrupted' : 'Update server is unreachable');
      }
      if (![301,302,303,307,308].includes(response.status)) {
        if (url.origin !== origin && response.status === 206) onRedirected?.(url.href);
        return response;
      }
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new UpdateTransferError('Missing update redirect');
      let next;
      try { next = new URL(location,url); }
      catch { throw new UpdateTransferError('Invalid update redirect'); }
      if (next.origin !== url.origin) auth = {};
      url = next;
    }
    throw new UpdateTransferError('Too many update redirects');
  }
  async function asset(source, version, name, headers = {}, timeout = 15000, requestSignal = signal, onRedirected) {
    validateUpdateSource(source);
    const token = tokenFor(source);
    if (source === 'nju') {
      const tag = version ? 'v'+encodeURIComponent(version) : 'permalink/latest';
      return request(gitlab+tag+'/downloads/'+encodeURIComponent(name),headers,token ? {'PRIVATE-TOKEN':token} : {},timeout,requestSignal);
    }
    if (!token) {
      const tag = version ? 'download/v'+encodeURIComponent(version) : 'latest/download';
      return request(githubPublic+tag+'/'+encodeURIComponent(name),headers,{},timeout,requestSignal,onRedirected);
    }
    const auth = {Authorization:'Bearer '+token};
    const tag = version ? 'tags/v'+encodeURIComponent(version) : 'latest';
    let assets = githubReleases.get(tag);
    if (!assets) {
      const response = await request(github+tag,{Accept:'application/vnd.github+json'},auth,15000,requestSignal);
      if (!response.ok) return response;
      const info = JSON.parse((await readBytes(response,1024*1024)).toString('utf8'));
      if (info.draft || info.prerelease || !Array.isArray(info.assets) ||
          (version && info.tag_name !== 'v'+version)) throw Error('Invalid GitHub release');
      assets = new Map(info.assets.filter(file => Number.isSafeInteger(file.id) && file.id > 0).map(file => [file.name,file.id]));
      githubReleases.set(tag,assets);
      githubReleases.set('tags/'+info.tag_name,assets);
    }
    const id = assets.get(name);
    return id ? request(github+'assets/'+id,{...headers,Accept:'application/octet-stream'},auth,timeout,requestSignal,onRedirected) : new Response(null,{status:404});
  }

  function installer(version, name, timeout) {
    let redirect;
    async function original(source, headers, requestSignal, onRedirected) {
      try { return await asset(source,version,name,headers,timeout,requestSignal,onRedirected); }
      catch (error) {
        requestSignal.throwIfAborted();
        throw new UpdateTransferError(error.message,{cause:error});
      }
    }
    async function discover(headers, requestSignal, consume) {
      let settle;
      const entry = {address:new Promise(resolve => { settle = resolve; })};
      redirect = entry;
      let address;
      try {
        const response = await original('github',headers,requestSignal,url => { address = url; });
        settle(address);
        return await consume(response);
      } catch (error) {
        if (redirect === entry && error instanceof UpdateTransferError) redirect = undefined;
        throw error;
      } finally { settle(undefined); }
    }
    return async (source, headers, requestSignal, consume) => {
      if (source !== 'github' || !headers.Range) return consume(await original(source,headers,requestSignal));
      for (let attempt = 1;; attempt++) {
        const entry = redirect;
        if (!entry) return discover(headers,requestSignal,consume);
        // Wait only for the first response headers to avoid repeating the release redirect.
        const address = await entry.address;
        requestSignal.throwIfAborted();
        if (!address) return consume(await original(source,headers,requestSignal));
        try { return await consume(await request(address,headers,{},timeout,requestSignal)); }
        catch (error) {
          requestSignal.throwIfAborted();
          if (!(error instanceof UpdateTransferError)) throw error;
          if (redirect === entry) redirect = undefined;
          if (attempt === 2) throw error;
        }
      }
    };
  }
  return {asset,installer,clear:() => githubReleases.clear()};
}
