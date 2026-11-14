/** Runtime selection provenance only; never an execution or project grant. */
import {isDeepStrictEqual as equal} from 'node:util';
const validId=value=>/^[a-f0-9]{20}$/.test(value||'');
export const globalSshBindingForProfile=(profile,binding)=>binding?.kind==='ssh'&&binding.profileId===profile?.id?binding:null;
export function preferredSshRuntime(profile,binding,preference){
 const saved=preference?.schemaVersion===1&&preference.profileId===profile.id&&preference.profileVersion===profile.version&&validId(preference.runtimeId)&&Array.isArray(preference.previousVersions)?preference:null;
 if(binding){if(binding.kind!=='ssh'||binding.profileId!==profile.id||!validId(binding.runtimeId))return undefined;return binding.profileVersion===profile.version||saved?.runtimeId===binding.runtimeId&&saved.previousVersions.includes(binding.profileVersion)?binding.runtimeId:undefined;}
 return saved?.runtimeId;
}
export function carrySshRuntimePreference(previous,next,binding,preference){
 if(previous?.kind!=='ssh'||next?.kind!=='ssh'||previous.id!==next.id||next.version!==previous.version+1)return null;
 const strip=profile=>{const {version,serviceEnvironment,...body}=profile;return body;};
 if(!equal(strip(previous),strip(next))||equal(previous.serviceEnvironment,next.serviceEnvironment))return null;
 const runtimeId=preferredSshRuntime(previous,binding,preference);if(!runtimeId)return null;
 const previousVersions=[...new Set([...(preference?.runtimeId===runtimeId&&preference.profileVersion===previous.version?preference.previousVersions||[]:[]),previous.version])].filter(Number.isSafeInteger).slice(-64);
 return {schemaVersion:1,profileId:next.id,profileVersion:next.version,runtimeId,previousVersions};
}
