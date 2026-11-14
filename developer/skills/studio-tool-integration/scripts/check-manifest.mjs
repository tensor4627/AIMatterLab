#!/usr/bin/env node
/** Standalone schema and declaration checks only. Does not execute the declared software. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateToolPackage,toolPackageResources} from '../references/tool-package.mjs';

export function checkManifest(file){
 const manifest=validateToolPackage(JSON.parse(fs.readFileSync(file,'utf8')));
 return {scope:'schema_checked',package_id:manifest.id,source_commit:manifest.repository.commit,manifest,declared_resources:toolPackageResources(manifest),installation:{status:'not_run'},tests:{status:'not_run'},next:'AIMatterLab package inspection must still verify actual Git, file and link closure; this command does not register, install or test the package.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv.length!==3)throw Error('Usage: node check-manifest.mjs /path/to/tool.json');console.log(JSON.stringify(checkManifest(path.resolve(process.argv[2])),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
