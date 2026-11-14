# AIMatterLab naming and upgrade compatibility

The current product name is **AIMatterLab**, with package/CLI slug `aimatterlab`. `contracts/product.json` supplies the visible name to the renderer and native window. Package, installation and HTML metadata are checked against it by `tests/desktop/product-brand.test.mjs`.

The rename changes product text, new executable/archive names, provider client display identity and current maintained guides. It does not rename the GPU-Sampling scientific engine, rewrite historical release/acceptance evidence, or modify existing run records.

Compatibility identities intentionally retained:

- Electron `science.gpusampling.studio` app ID, `.config` profile location and `STUDIO_PROFILE_DIR` override. The repository resolver accepts both `aimatterlab` and legacy `gpu-sampling-studio` manifests without moving data. Existing SSH registrations, credential vault, project grants and run index remain in the same profile. Portable upgrades must retain the existing portable folder (or use the explicit profile override), as before the rename.
- `studio:*` IPC/MCP and context markers, `studio_worker` Python module, schema IDs, catalog keys, localStorage keys, runtime resource names and provider isolation identifiers. These are interfaces and persisted identities, not current product labels.
- Existing worker health `name: gpu-sampling-studio` remains the authenticated wire identity accepted by older clients and services. Current worker health adds `product_name: AIMatterLab` for display. Renaming the authenticated identity would unnecessarily reject existing registered services.
- Existing remote worker/SSH state and run directory defaults, and the Windows `GPU Sampling Studio/terminal-runtime` executable cache, retain their established paths. No credential, connection, job or runtime migration runs as part of branding.
- Historical changelog, version/release reports, iteration reports and archived acceptance evidence retain their original names and validation scope. Engine names such as GPUMD GPU-Sampling retain their scientific meaning.

The canonical brand tests and profile upgrade test cover these boundaries. Branding alone makes no new scientific validation claim. Native UI/package acceptance is recorded separately in the release evidence.
