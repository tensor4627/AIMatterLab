interface HumanInputSession {sessionId:string;ownerEpoch:number;humanInputSequence?:number}
interface HumanInputPacket {sessionId:string;ownerEpoch:number;requestId:string;data:string;inputSequence?:number}
export function createHumanInputWriter(): (send:(packet:HumanInputPacket)=>Promise<unknown>,session:HumanInputSession,requestId:string,data:string)=>Promise<void>;
