import type {ModelProfile} from '../dto/model-profiles';
export const API_PROTOCOLS:string[];
export const REASONING_LEVELS:string[];
export const API_PROVIDER_GROUPS:string[];
export const API_PRESETS:Record<string,{name:string;baseUrl:string;api:ModelProfile['api'];catalogProvider?:string}>;
export function apiModelKey(profileId:string,modelId:string):string;
export function splitApiModelKey(value:unknown):{profileId:string;modelId:string}|null;
export function validateModelProfile(value:unknown):ModelProfile;
