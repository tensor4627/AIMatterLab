import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findStudioRepository, resolveStudioProfileBase, studioProfileRoot} from '../../desktop/platform/studio-profile.mjs';

function checkout(name='aimatterlab') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-profile-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name}));
  fs.mkdirSync(path.join(root, 'desktop'));
  fs.writeFileSync(path.join(root, 'desktop', 'main.mjs'), '// fixture\n');
  return root;
}

test('a source checkout resolves its own root and keeps data in .config', () => {
  const root = checkout();
  assert.equal(findStudioRepository(root), root);
  assert.equal(resolveStudioProfileBase({appRoot: root, isPackaged: false}), root);
  assert.equal(studioProfileRoot({appRoot: root, isPackaged: false}), path.join(root, '.config'));
});

test('a portable build inside the checkout keeps data in the checkout .config', () => {
  const root = checkout();
  const portableDir = path.join(root, 'release', 'v1.0.2-dev.1');
  const execPath = path.join(portableDir, 'win-unpacked', 'AIMatterLab.exe');
  assert.equal(resolveStudioProfileBase({isPackaged: true, portableDir, execPath}), root);
  assert.equal(studioProfileRoot({isPackaged: true, portableDir, execPath}), path.join(root, '.config'));
});

test('a packaged build outside a checkout falls back to its own folder', () => {
  const portableDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-portable-'));
  const execPath = path.join(portableDir, 'win-unpacked', 'AIMatterLab.exe');
  assert.equal(findStudioRepository(portableDir), null);
  assert.equal(resolveStudioProfileBase({isPackaged: true, portableDir, execPath}), portableDir);
  assert.equal(studioProfileRoot({isPackaged: true, portableDir, execPath}), path.join(portableDir, '.config'));
  assert.equal(resolveStudioProfileBase({isPackaged: true, execPath}), path.dirname(execPath));
});

test('a checkout marker needs both the product name and the desktop entry', () => {
  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-unrelated-'));
  fs.writeFileSync(path.join(unrelated, 'package.json'), JSON.stringify({name: 'other-product'}));
  fs.mkdirSync(path.join(unrelated, 'desktop'));
  fs.writeFileSync(path.join(unrelated, 'desktop', 'main.mjs'), '// fixture\n');
  assert.equal(findStudioRepository(unrelated), null);
  const incomplete = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-incomplete-'));
  fs.writeFileSync(path.join(incomplete, 'package.json'), JSON.stringify({name: 'gpu-sampling-studio'}));
  assert.equal(findStudioRepository(incomplete), null);
});

// This read-only compatibility alias must never copy or rename existing user state.
test('legacy checkout and renamed build resolve the same existing profile', () => {
  const root=checkout('gpu-sampling-studio');
  const profile=path.join(root,'.config');fs.mkdirSync(profile);
  const sentinel=path.join(profile,'existing-settings');fs.writeFileSync(sentinel,'preserved');
  assert.equal(studioProfileRoot({appRoot:root,isPackaged:false}),profile);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'aimatterlab'}));
  assert.equal(findStudioRepository(root),root);
  assert.equal(studioProfileRoot({isPackaged:true,portableDir:path.join(root,'release','new'),execPath:path.join(root,'release','new','AIMatterLab.exe')}),profile);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'preserved');
});
