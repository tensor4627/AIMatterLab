export const providerNames:Record<string,string>;

export type AccountConfiguration='configured'|'missing'|'unknown';
export function providerAccountState(provider:string,value:any):AccountConfiguration;

export function authenticationError(error:unknown):boolean;
