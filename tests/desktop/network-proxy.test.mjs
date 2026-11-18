import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {networkProxy,windowsProxySettings,readWindowsProxy,configureNetworkSession} from '../../desktop/platform/network-proxy.mjs';
const exec=promisify(execFile),quiet=()=>{};
const system=server=>({enabled:true,server,bypass:'*.intranet.invalid;<local>'});
test('credential-bearing environment proxies keep CLI authentication and yield a valid Chromium route',()=>{
 const endpoint = 'http://fixture:synthetic@proxy.fixture.invalid:8080';
 const config = networkProxy({env:{HTTPS_PROXY:endpoint},platform:'win32',report:quiet});
 assert.equal(config.env.HTTPS_PROXY,endpoint);
 assert.equal(config.sessionConfig.proxyRules,'https=http://proxy.fixture.invalid:8080');
 assert(!JSON.stringify(config.sessionConfig).includes('synthetic'));
});
test('Chromium bypasses short intranet names only when the user selected that rule',()=>{
 const proxy = 'http://proxy.fixture.invalid:8888';
 const explicit = networkProxy({platform:'win32',env:{HTTP_PROXY:proxy,NO_PROXY:'build.fixture.invalid'},report:quiet});
 const fromWindows = bypass => networkProxy({platform:'win32',env:{},readSystem:()=>({enabled:true,server:proxy,bypass}),report:quiet});
 for(const config of [explicit, fromWindows('*.fixture.invalid')]){
  const rules = config.sessionConfig.proxyBypassRules.split(';');
  assert(!rules.includes('<local>'));
  assert(rules.includes('localhost') && rules.includes('127.0.0.0/8'));
 }
 assert(fromWindows('<local>;*.fixture.invalid').sessionConfig.proxyBypassRules.split(';').includes('<local>'));
});
test('Windows registry discovery is bounded, shell-free, and honors ProxyEnable',()=>{
 const settings=readWindowsProxy({env:{SystemRoot:'C:\\Windows'},execute:(file,args,options)=>{assert.equal(file,'C:\\Windows\\System32\\reg.exe');assert.equal(args[0],'query');assert.equal(options.timeout,5000);assert.equal(options.maxBuffer,128*1024);return ' ProxyEnable    REG_DWORD    0x1\r\n ProxyServer    REG_SZ    127.0.0.1:9876\r\n ProxyOverride    REG_SZ    *.intranet.invalid;<local>\r\n';}});
 assert.deepEqual(settings,{...system('127.0.0.1:9876'),pac:''});assert.equal(windowsProxySettings('ProxyEnable REG_DWORD 0x0').enabled,false);
});
test('system-only Clash proxy reaches all child lanes and Electron with loopback bypass',async()=>{
 const logs=[],config=networkProxy({platform:'win32',env:{PATH:'fixture'},readSystem:()=>system('127.0.0.1:9876'),report:v=>logs.push(v)});
 assert.equal(config.source,'system');for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])assert.equal(config.env[key],'http://127.0.0.1:9876');assert.equal(config.env.ELECTRON_GET_USE_PROXY,'1');assert.equal(config.env.NODE_USE_ENV_PROXY,'1');for(const value of ['localhost','127.0.0.1','::1','.intranet.invalid'])assert(config.env.NO_PROXY.split(',').includes(value));
 const calls=[];await configureNetworkSession({setProxy:async value=>calls.push(value)},config);assert.equal(calls[0].mode,'fixed_servers');assert.match(calls[0].proxyRules,/https=http:\/\/127.0.0.1:9876/);assert.match(calls[0].proxyBypassRules,/127.0.0.0\/8/);assert(!logs.join('').includes('9876'));assert.match(logs[0],/不代表连通/);
});
test('explicit environment proxy wins, upper/lower aliases agree, user bypass entries survive',()=>{
 const config=networkProxy({platform:'win32',env:{https_proxy:'http://selected.invalid:8000',HTTPS_PROXY:'http://stale.invalid:80',NO_PROXY:'private.invalid',no_proxy:'second.invalid'},readSystem:()=>assert.fail('explicit proxy must not be replaced'),report:quiet});assert.equal(config.env.HTTPS_PROXY,'http://selected.invalid:8000');assert.match(config.env.NO_PROXY,/private.invalid/);assert.match(config.env.NO_PROXY,/second.invalid/);assert.equal(config.env.NO_PROXY,config.env.no_proxy);
});
test('protocol-specific Windows proxies retain separate routes; disabled proxy does not affect direct or TUN',()=>{
 const config=networkProxy({platform:'win32',env:{},readSystem:()=>system('http=127.0.0.1:8080;https=127.0.0.1:8081'),report:quiet});assert.equal(config.env.HTTP_PROXY,'http://127.0.0.1:8080');assert.equal(config.env.HTTPS_PROXY,'http://127.0.0.1:8081');
 const direct=networkProxy({platform:'win32',env:{PATH:'fixture'},readSystem:()=>({enabled:false,server:'stale.invalid:8080'}),report:quiet});assert.deepEqual(direct.env,{PATH:'fixture'});assert.equal(direct.sessionConfig.mode,'system');
});
test('invalid configured proxy fails closed; PAC and discovery failures are identified without secrets',()=>{
 assert.throws(()=>networkProxy({env:{HTTPS_PROXY:'http://bad.invalid/path?private'},report:quiet}),/不会回退直连/);
 const logs=[];networkProxy({platform:'win32',env:{},readSystem:()=>{throw Error('private');},report:v=>logs.push(v)});networkProxy({platform:'win32',env:{},readSystem:()=>({pac:'https://private.invalid/proxy.pac'}),report:v=>logs.push(v)});assert.match(logs[0],/无法读取/);assert.match(logs[1],/PAC/);assert(!logs.join('').includes('private'));
});
test('real Node child uses discovered proxy for HTTP and fetch, and bypasses it for the local worker',async t=>{
 const requests=[],sockets=new Set(),proxy=http.createServer((req,res)=>{requests.push(req.url);res.end('proxied');});
 proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 proxy.on('connect',(req,socket)=>{requests.push(req.url);socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.once('data',()=>socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied'));});
 const local=http.createServer((_req,res)=>res.end('local'));await new Promise(r=>proxy.listen(0,'127.0.0.1',r));await new Promise(r=>local.listen(0,'127.0.0.1',r));t.after(()=>{for(const socket of sockets)socket.destroy();proxy.close();local.close();});
 const config=networkProxy({env:{},platform:'win32',readSystem:()=>system('127.0.0.1:'+proxy.address().port),report:quiet});
 const code=`import http from 'node:http';const get=url=>new Promise((resolve,reject)=>http.get(url,res=>{let s='';res.on('data',v=>s+=v);res.on('end',()=>resolve(s));}).on('error',reject));console.log(JSON.stringify([await get('http://aimlab-proxy-fixture.invalid/test'),await (await fetch('http://aimlab-proxy-fixture.invalid/fetch')).text(),await get('http://127.0.0.1:${local.address().port}/health')]));`;
 const {stdout}=await exec(process.execPath,['--input-type=module','-e',code],{env:{...process.env,...config.env,ALL_PROXY:'',all_proxy:''},timeout:10000,maxBuffer:65536});assert.deepEqual(JSON.parse(stdout),['proxied','proxied','local']);assert.equal(requests.length,2);
});
