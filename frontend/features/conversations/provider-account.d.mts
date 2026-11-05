export const providerNames:Record<string,string>;

export function providerAccountState(provider:string,value:any):'configured'|'missing'|'unknown';

export function authenticationError(error:unknown):boolean;
