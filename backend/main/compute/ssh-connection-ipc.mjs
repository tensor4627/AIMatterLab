/** Human-only typed connection operations; no authentication entry is an MCP tool. */
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const schemas={open:['profileId','profileVersion','requestId'],list:[],state:['connectionId'],authRead:['connectionId','cursor','maxBytes'],authInput:['connectionId','requestId','data'],authResize:['connectionId','cols','rows'],confirm:['connectionId'],completeLogin:['connectionId','requestId','userConfirmed'],loginStatus:['connectionId','requestId'],openShell:['connectionId','requestId'],close:['connectionId']};
export function validateSshConnectionRequest(method,value){
 const keys=schemas[method];if(!keys||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('ssh_connection_invalid_request');
 const required=method==='authRead'?['connectionId']:keys.filter(key=>key!=='userConfirmed');
 if(required.some(key=>!Object.hasOwn(value,key)))throw Error('ssh_connection_invalid_request');
 for(const key of ['connectionId','profileId','requestId'])if(Object.hasOwn(value,key)&&!identifier(value[key]))throw Error('ssh_connection_invalid_request');
 if('userConfirmed' in value&&value.userConfirmed!==true)throw Error('ssh_connection_invalid_request');
 if('profileVersion' in value&&(!Number.isSafeInteger(value.profileVersion)||value.profileVersion<1)||'cursor' in value&&(!Number.isSafeInteger(value.cursor)||value.cursor<0)||'maxBytes' in value&&(!Number.isSafeInteger(value.maxBytes)||value.maxBytes<1||value.maxBytes>65536)||'data' in value&&(typeof value.data!=='string'||!value.data||Buffer.byteLength(value.data)>8192)||'cols' in value&&(!Number.isSafeInteger(value.cols)||value.cols<10||value.cols>500)||'rows' in value&&(!Number.isSafeInteger(value.rows)||value.rows<2||value.rows>300))throw Error('ssh_connection_invalid_request');
 return value;
}
export function registerSshConnectionRoutes({handle,connections,onOpening=()=>{},onAuthenticated=()=>{},onClosing=()=>{},onClosed=()=>{},onUnknown=()=>{},onChange=()=>{}}){
 async function operation(method,value){
  validateSshConnectionRequest(method,value);
  if(method==='open')onOpening(value);
  if(method==='close')onClosing(value.connectionId);
  let result;try{result=await connections[method](value);}catch(error){if(method==='close')onUnknown(value.connectionId);throw error;}
  if(method==='close'){if(result?.status==='closed'&&result.closed===true)onClosed(value.connectionId);else onUnknown(value.connectionId);}
  if(['open','confirm','openShell','close'].includes(method)||method==='completeLogin'&&(result?.shell||result?.login?.status==='complete'))onChange({method,connectionId:result?.connectionId||value.connectionId});
  if(['confirm','completeLogin','loginStatus'].includes(method)){
   const connection=method==='confirm'?result:result?.connection;
   if(connection?.connectionId===value.connectionId&&connection.status==='authenticated'&&connection.authentication==='verified'&&
      connection.capabilities?.multiplex===true&&(value.requestId===undefined||connection.loginRequestId===value.requestId)){
    const {connectionId,profileId,profileVersion,loginRequestId}=connection;
    void Promise.resolve().then(()=>onAuthenticated({connectionId,profileId,profileVersion},loginRequestId)).catch(()=>{});
   }
  }
  return result;
 }
 for(const method of Object.keys(schemas))handle('compute.sshConnection.'+method,value=>operation(method,value));
 return {async closeExact(target){
  const {connectionId}=target;
  let result;
  try{result=await connections.closeExact(target);}
  catch(error){if(!['ssh_connection_changed','ssh_connection_not_found'].includes(error.message))onUnknown(connectionId);throw error;}
  if(result?.status==='closed'&&result.closed===true){onClosing(connectionId);onClosed(connectionId);}
  else onUnknown(connectionId);
  onChange({method:'close',connectionId});
  return result;
 }};
}
