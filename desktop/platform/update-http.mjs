import {Readable} from 'node:stream';

// Electron net.fetch rejects manual redirects. ClientRequest exposes the target
// before following it, so the feed layer can scope credentials on every hop.
export function electronUpdateFetch(net, url, {headers, signal}) {
  return new Promise((resolve,reject) => {
    signal.throwIfAborted();
    const request = net.request({url,method:'GET',redirect:'manual',credentials:'omit',cache:'no-store'});
    for (const [key,value] of Object.entries(headers)) request.setHeader(key,value);
    let stream;
    const abort = () => {
      reject(signal.reason);
      stream?.destroy(signal.reason);
      request.abort();
    };
    signal.addEventListener('abort',abort,{once:true});
    request.once('close',() => signal.removeEventListener('abort',abort));
    request.on('error',reject);
    request.once('redirect',(status,_method,location) => {
      resolve(new Response(null,{status,headers:{location}}));
      request.abort();
    });
    request.once('response',response => {
      stream = response;
      const metadata = new Headers();
      for (const [name,values] of Object.entries(response.headers)) {
        for (const value of [].concat(values)) metadata.append(name,value);
      }
      const empty = [204,205,304].includes(response.statusCode);
      if (empty) response.resume();
      resolve(new Response(empty ? null : Readable.toWeb(response),{status:response.statusCode,headers:metadata}));
    });
    request.end();
  });
}
