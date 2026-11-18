// Private JSON pipe for the Python installer; never print this payload to installation logs.
import {networkProxy} from '../desktop/platform/network-proxy.mjs';
const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','ELECTRON_GET_USE_PROXY','NODE_USE_ENV_PROXY'];
try {
 const {env} = networkProxy({report: message => console.error(message)});
 const selected = Object.fromEntries(keys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
 process.stdout.write(JSON.stringify(selected));
} catch {
 console.error('[网络] 无法准备代理配置，请检查系统设置或显式代理地址。');
 process.exitCode = 1;
}
