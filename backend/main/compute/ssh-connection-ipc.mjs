/** Human-only typed connection operations; no authentication entry is an MCP tool. */
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const schemas={open:['profileId','profileVersion','requestId'],list:[],state:['connectionId'],authRead:['connectionId','cursor','maxBytes'],authInput:['connectionId','requestId','data'],authResize:['connectionId','cols','rows'],confirm:['connectionId'],completeLogin:['connectionId','requestId'],loginStatus:['connectionId','requestId'],openShell:['connectionId','requestId'],close:['connectionId']};
export function validateSshConnectionRequest(method,value){
 const keys=schemas[method];if(!keys||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('ssh_connection_invalid_request');
 const required=method==='authRead'?['connectionId']:keys;
 if(required.some(key=>!Object.hasOwn(value,key)))throw Error('ssh_connection_invalid_request');
 for(const key of ['connectionId','profileId','requestId'])if(Object.hasOwn(value,key)&&!identifier(value[key]))throw Error('ssh_connection_invalid_request');
 if('profileVersion' in value&&(!Number.isSafeInteger(value.profileVersion)||value.profileVersion<1)||'cursor' in value&&(!Number.isSafeInteger(value.cursor)||value.cursor<0)||'maxBytes' in value&&(!Number.isSafeInteger(value.maxBytes)||value.maxBytes<1||value.maxBytes>65536)||'data' in value&&(typeof value.data!=='string'||!value.data||Buffer.byteLength(value.data)>8192)||'cols' in value&&(!Number.isSafeInteger(value.cols)||value.cols<10||value.cols>500)||'rows' in value&&(!Number.isSafeInteger(value.rows)||value.rows<2||value.rows>300))throw Error('ssh_connection_invalid_request');
 return value;
}
export function registerSshConnectionRoutes({handle,connections,onClosing=()=>{},onClosed=()=>{},onUnknown=()=>{},onChange=()=>{}}){
 for(const method of Object.keys(schemas))handle('compute.sshConnection.'+method,async value=>{
  validateSshConnectionRequest(method,value);
  if(method==='close')onClosing(value.connectionId);
  let result;try{result=await connections[method](value);}catch(error){if(method==='close')onUnknown(value.connectionId);throw error;}
  if(method==='close'){if(result?.status==='closed'&&result.closed===true)onClosed(value.connectionId);else onUnknown(value.connectionId);}
  if(['open','confirm','openShell','close'].includes(method)||method==='completeLogin'&&result?.shell)onChange({method,connectionId:result?.connectionId||value.connectionId});
  return result;
 });
}
