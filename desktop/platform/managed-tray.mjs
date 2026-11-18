/** Closing the last workbench window keeps the authenticated resources under the same owner. */
export function installManagedTray({app,window,Tray,Menu,icon,language,isQuitting}) {
  const tray = new Tray(icon);
  const show = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();window.focus();
  };
  const menu = () => {
    const en = language() === 'en';
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:en?'Open AIMatterLab':'打开 AIMatterLab',click:show},
      {type:'separator'},
      {label:en?'Quit AIMatterLab':'退出 AIMatterLab',click:()=>app.quit()},
    ]));
  };
  tray.setToolTip('AIMatterLab');
  tray.on('click',show);tray.on('double-click',show);
  const hide = event => {
    if (isQuitting()) return;
    event.preventDefault();window.hide();
  };
  window.on('close',hide);menu();
  const destroy = () => {
    window.removeListener('close',hide);
    if (!tray.isDestroyed()) tray.destroy();
  };
  app.once('will-quit',destroy);
  return {show,menu,destroy};
}
