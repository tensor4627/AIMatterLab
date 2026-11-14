import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT,PRODUCT_NAME,PRODUCT_SLUG} from '../../contracts/product.mjs';
const root=new URL('../../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
test('public package and installation identity use the canonical brand while app identity stays compatible',()=>{
 const pkg=JSON.parse(read('package.json')),installation=JSON.parse(read('installation/manifest.json'));
 assert.equal(PRODUCT_NAME,'AIMatterLab');assert.equal(PRODUCT_SLUG,'aimatterlab');
 assert.equal(pkg.name,PRODUCT_SLUG);assert.equal(pkg.build.productName,PRODUCT_NAME);assert.equal(pkg.author,PRODUCT_NAME);
 assert.equal(pkg.build.appId,'science.gpusampling.studio');assert.equal(installation.product,PRODUCT_NAME);
 for(const target of [pkg.build.win,pkg.build.portable])assert.ok(target.artifactName.startsWith(PRODUCT_NAME+'-'));
 assert.match(read('index.html'),new RegExp('<title>'+PRODUCT_NAME+'</title>'));
 for(const file of ['desktop/main.mjs','frontend/app/App.tsx','frontend/features/settings/SettingsPage.tsx','frontend/features/conversations/ChatMessage.tsx'])assert.match(read(file),/contracts\/product\.(?:json|mjs)/);
});
test('renderer cannot regress to the old visible brand; internal API and transcript markers remain compatible',()=>{
 const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())visit(file);else if(/\.(?:tsx?|html)$/.test(file)){const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/GPU Sampling|GPU-Sampling-Studio|GPU Sampling Studio/);const display=source.replace(/export interface Studio|studio\?:Studio|\[Studio workspace context\]/g,'');assert.doesNotMatch(display,/\bStudio\b/);}}};
 visit(fileURLToPath(new URL('frontend/',root)));
 assert.equal(PRODUCT.legacyPackageName,'gpu-sampling-studio');
 assert.match(read('desktop/main.mjs'),/app\.setPath\('userData',profile\)/);
 assert.match(read('desktop/platform/studio-profile.mjs'),/\.config/);
});
