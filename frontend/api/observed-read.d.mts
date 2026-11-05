export interface ReadObservation<T>{value:T|null;observedAt:number|null;error:string|null;pending:boolean;connected:boolean;failures:number;paused:boolean}

export class ObservedRead<T>{constructor(read:()=>Promise<T>,publish:(state:ReadObservation<T>)=>void,options?:{delay?:number;maxFailures?:number;now?:()=>number;schedule?:typeof setTimeout;unschedule?:typeof clearTimeout});state:ReadObservation<T>;setConnected(connected:boolean):void;refresh(manual?:boolean):Promise<unknown>;dispose():void}
