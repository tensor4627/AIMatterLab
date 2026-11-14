import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
// Scope legacy aliases to a product-label slot, never arbitrary scientific/provenance prose.
const retiredProductLabel=value=>['GPU Sampling Studio','GPU-Sampling-Studio','Studio'].includes(value.trim());
test('actual renderer product-label slots use the canonical name without scanning unrelated prose',()=>{
 const app=read('frontend/app/App.tsx');
 assert.match(app,/<strong>\{product.name\}<\/strong>/);
 assert.match(app,/className="sidebar-title"><span>\{product.name\}<\/span>/);
 assert.match(read('frontend/features/settings/SettingsPage.tsx'),/className="font-preview">[^\n]*\{product.name\}/);
 assert.match(read('frontend/features/conversations/ChatMessage.tsx'),/m.role==='user'\?'你':product.name/);
 assert.equal(retiredProductLabel(PRODUCT_NAME),false);
 assert.equal(PRODUCT.legacyPackageName,'gpu-sampling-studio');
 assert.match(read('desktop/main.mjs'),/app\.setPath\('userData',profile\)/);
 assert.match(read('desktop/platform/studio-profile.mjs'),/\.config/);
});
test('legacy product-label detection permits scientific names, IDEs and product lineage explanations',()=>{
 for(const label of ['GPU Sampling Studio','GPU-Sampling-Studio','Studio'])assert.equal(retiredProductLabel(label),true);
 for(const text of ['GPU Sampling','GPU-Sampling enhanced sampling','Visual Studio','ModelStudio','AIMatterLab','Previously named GPU Sampling Studio; historical evidence is preserved.'])assert.equal(retiredProductLabel(text),false,text);
});
