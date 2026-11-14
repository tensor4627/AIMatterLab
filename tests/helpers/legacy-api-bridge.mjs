// Explicit fixtures for existing lifecycle/credential contracts. Production
// routing is covered separately by harness-routing.test.mjs.
import {DeepSeekBridge} from '../../agent/providers/deepseek.mjs';
export const legacyApiBridgeFactories={
 deepseek:options=>new DeepSeekBridge(options),
 compatible:options=>new DeepSeekBridge(options)
};
