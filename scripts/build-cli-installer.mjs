import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require=createRequire(import.meta.url),viteRequire=createRequire(require.resolve('vite/package.json'));
const {build}=viteRequire('esbuild');
const result=await build({entryPoints:[path.resolve('scripts/cli-archive-source.mjs')],outfile:path.resolve('dist/cli-installer/archive.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',minify:true,metafile:true,legalComments:'eof',banner:{js:"import {createRequire as __studioCreateRequire} from 'node:module';const require=__studioCreateRequire(import.meta.url);"}});
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
 if(!input.includes('node_modules'))continue;
 let directory=path.dirname(path.resolve(input)),pkg;
 while(true){
  const manifest=path.join(directory,'package.json');
  if(fs.existsSync(manifest)){const value=JSON.parse(fs.readFileSync(manifest,'utf8'));if(value.name){pkg=value;break;}}
  const parent=path.dirname(directory);if(parent===directory)throw Error('Missing archive dependency license metadata');directory=parent;
 }
 if(packages.has(pkg.name))continue;
 const licenses=fs.readdirSync(directory).filter(name=>/^licen[sc]e(?:\.|$)/i.test(name)).map(name=>fs.readFileSync(path.join(directory,name),'utf8'));
 if(!licenses.length)throw Error('Missing archive dependency license: '+pkg.name);
 packages.set(pkg.name,pkg.name+' '+pkg.version+' ('+pkg.license+')\n\n'+licenses.join('\n\n'));
}
fs.writeFileSync(path.resolve('dist/cli-installer/LICENSES.txt'),[...packages].sort(([a],[b])=>a.localeCompare(b)).map(([,body])=>body).join('\n\n========================================\n\n')+'\n');
