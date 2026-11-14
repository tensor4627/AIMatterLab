import {createCliRuntimeManager as createManager} from '../../backend/main/compute/cli-runtime.mjs';
import {AcpBridge} from '../../agent/providers/acp.mjs';
export {isStaleBundledCliPath,migrateBundledCliPaths} from '../../backend/main/compute/cli-runtime.mjs';

/** Host composition supplies the protocol adapter; the backend owns installation state. */
export function createCliRuntimeManager(options={}){
 return createManager({...options,createBridge:options.createBridge||((provider,config)=>new AcpBridge(provider,config))});
}
