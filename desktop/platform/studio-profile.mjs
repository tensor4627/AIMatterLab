import fs from 'node:fs';
import path from 'node:path';

// New branding must resolve the same checkout and .config as older builds.
const PRODUCT_NAMES = new Set(['aimatterlab', 'gpu-sampling-studio']);

/**
 * Find the repository checkout that owns this AIMatterLab build.
 * Used only in the test phase so local state can live in the checkout `.config`
 * instead of the shared Windows `%APPDATA%` profile.
 */
export function findStudioRepository(start) {
  if (typeof start !== 'string' || !start) return null;
  let current = path.resolve(start);
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8'));
      if (PRODUCT_NAMES.has(manifest?.name) && fs.existsSync(path.join(current, 'desktop', 'main.mjs'))) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve the base directory whose `.config` holds the AIMatterLab profile in the test phase.
 * Priority: the checkout that contains this build, otherwise the portable bundle folder,
 * otherwise the unpacked executable folder. An explicit STUDIO_PROFILE_DIR still wins in
 * main.mjs and bypasses this resolver.
 */
export function resolveStudioProfileBase({appRoot, isPackaged, portableDir, execPath}) {
  if (isPackaged) {
    const starts = [];
    if (typeof portableDir === 'string' && portableDir) starts.push(portableDir);
    if (typeof execPath === 'string' && execPath) starts.push(path.dirname(execPath));
    for (const start of starts) {
      const repository = findStudioRepository(start);
      if (repository) return repository;
    }
    if (starts.length) return starts[0];
  } else if (typeof appRoot === 'string' && appRoot) {
    return findStudioRepository(appRoot) || path.resolve(appRoot);
  }
  throw new Error('Cannot resolve the AIMatterLab profile base directory');
}

export function studioProfileRoot(options) {
  return path.join(resolveStudioProfileBase(options), '.config');
}
