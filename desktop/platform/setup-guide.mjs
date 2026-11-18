const pages = new Set(['welcome', 'agent', 'compute', 'ready', 'complete']);

export function createSetupGuide({catalog, existingProfile, directory, directoryKind, openDirectory}) {
  const read = () => catalog.get('setup-guide', 'desktop');
  const write = page => catalog.put('setup-guide', 'desktop', {version: 1, page});
  catalog.transaction(()=>{if (!read()) write(existingProfile ? 'complete' : 'welcome');});

  return {
    info() {
      return {page: read().page, directory, directoryKind};
    },
    progress(request) {
      if (!request || Array.isArray(request) || Object.keys(request).length !== 1 || !pages.has(request.page)) throw Error('Invalid setup page');
      // Reopening the guide from Help is voluntary, including after the next restart.
      catalog.transaction(()=>{if (read().page !== 'complete') write(request.page);});
      return this.info();
    },
    async open(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length) throw Error('Unexpected workspace location argument');
      const error = await openDirectory(directory);
      if (error) throw Error(error);
      return {opened: true};
    }
  };
}
