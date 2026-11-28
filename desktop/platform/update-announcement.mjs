import path from 'node:path';
import {readBounded,safeDirectory} from './app-update-transaction.mjs';
import {validReleaseVersion} from './update-release.mjs';

export function updateAnnouncement(version,changelog){
  const sections=changelog.replaceAll('\r\n','\n').split(/^## /m).slice(1);
  const section=sections.find(text=>text.split('\n',1)[0].trim()===version);
  const changes=section?.split('\n').filter(line=>line.startsWith('- ')).map(line=>line.slice(2).trim()).filter(Boolean)??[];
  return {version,changes};
}

export async function installerCompletedInAppUpdate(workspace,version){
  if(!workspace||!validReleaseVersion(version))return false;
  const directory=path.join(workspace.cache,'updates');
  if(!await safeDirectory(directory))return false;
  const marker=await readBounded(path.join(directory,`announce-update-${version}.ready`),0);
  return marker!==null;
}

export function announceUpdateOnce(catalog,announcement,show){
  const {version}=announcement,kind='update-announcement';
  const claimed=catalog.transaction(()=>{
    if(catalog.get(kind,version))return false;
    catalog.put(kind,version,{version,shownAt:Date.now()});
    return true;
  });
  if(!claimed)return false;
  show(announcement);
  return true;
}
