// Only the page is replaced. The desktop keeps its existing worker, brokers and IPC handlers.
export function loadRecoverableWorkbench({window, load, isQuitting, recordExit, askRetry, now = Date.now}) {
  const contents = window.webContents;
  const active = () => !isQuitting() && !window.isDestroyed() && !contents.isDestroyed();
  let generation = 0;
  let lastRetry = -Infinity;
  let prompting = false;
  let retryOnShow = false;

  return new Promise((resolve, reject) => {
    function navigate(recovering) {
      const current = ++generation;
      // Leave Electron's process-exit event before starting the next navigation.
      Promise.resolve().then(() => {
        if (current === generation && active()) return load();
      }).then(() => {
        if (current === generation && active()) resolve(true);
      }, error => {
        if (current !== generation || !active()) return;
        if (recovering) void prompt();
        else if (contents.isCrashed()) setImmediate(() => {
          if (current === generation && active()) void prompt();
        });
        else reject(error);
      });
    }

    async function prompt() {
      if (prompting || retryOnShow || !active()) return;
      prompting = true;
      let retry = false;
      try { retry = await askRetry(); }
      catch { /* Reopening from the tray also retries if the native dialog is unavailable. */ }
      finally { prompting = false; }
      if (!active()) return;
      if (retry) {
        lastRetry = now();
        navigate(true);
      } else {
        retryOnShow = true;
        window.hide();
      }
    }

    contents.on('render-process-gone', (_event, details) => {
      if (!active()) return;
      generation++;
      recordExit(details);
      if (prompting || retryOnShow) return;
      if (now() - lastRetry < 60000) {
        void prompt();
        return;
      }
      lastRetry = now();
      navigate(true);
    });
    window.on('show', () => {
      if (!retryOnShow || !active()) return;
      retryOnShow = false;
      lastRetry = now();
      navigate(true);
    });
    contents.once('destroyed', () => { generation++; resolve(false); });
    navigate(false);
  });
}
