// Private JSON pipe for the Python installer; never print this payload to installation logs.
import {networkProxy} from '../desktop/platform/network-proxy.mjs';
const {env}=networkProxy({report:message=>console.error(message)});
const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','ELECTRON_GET_USE_PROXY','NODE_USE_ENV_PROXY'];
process.stdout.write(JSON.stringify(Object.fromEntries(keys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]))));
