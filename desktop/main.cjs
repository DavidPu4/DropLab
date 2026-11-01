'use strict';

const { app, BrowserWindow, dialog, Menu, protocol, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { APP_ORIGIN, createProtocolHandler, isAppURL, isAllowedExternalURL } = require('./protocol.cjs');

// Register before app.ready. A stable, standard origin keeps browser storage
// across launches without a localhost server, changing ports, or cloud sign-in.
protocol.registerSchemesAsPrivileged([{ scheme: 'droplab', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);

app.setName('DropLab');
app.setAppUserModelId('com.davidpu.droplab');
const smokeMode = process.argv.includes('--smoke-test');
const profileRoot = smokeMode ? fs.mkdtempSync(path.join(os.tmpdir(), 'droplab-smoke-'))
  : path.join(app.getPath('appData'), 'DropLab');
fs.mkdirSync(profileRoot, { recursive: true });
app.setPath('userData', profileRoot);
const hasInstanceLock = smokeMode || app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

let mainWindow;
let providers;
function applicationRoot() {
  const selected = app.getAppPath();
  if (fs.existsSync(path.join(selected, 'lib', 'tiktok-provider.js'))) return selected;
  // Also support Electron's direct-entry development invocation. Packaged apps
  // always resolve the first branch inside app.asar.
  const parent = path.dirname(selected);
  if (!app.isPackaged && fs.existsSync(path.join(parent, 'lib', 'tiktok-provider.js'))) return parent;
  throw new Error('The bundled provider modules are missing.');
}
function providerModules() {
  if (!providers) providers = Promise.all([
    import(pathToFileURL(path.join(applicationRoot(), 'lib', 'tiktok-provider.js')).href),
    import(pathToFileURL(path.join(applicationRoot(), 'lib', 'research-provider.js')).href),
  ]);
  return providers;
}

function configureMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'close' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About DropLab', click: () => dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'About DropLab', message: `DropLab ${app.getVersion()}`,
      detail: 'A local product research workspace. Your workspace stays on this computer. Live discovery uses your own Apify account and credits.',
    }) }] },
  ]));
}

async function smokeTest(window) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript("document.documentElement.dataset.desktopReady === 'true'")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const first = await window.webContents.executeJavaScript(`(async () => {
    const response = await fetch('/api/discovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', runId: 'SmokeTestRun12345' }) });
    const result = await response.json();
    localStorage.setItem('droplab.desktop.smoke', 'persists');
    return { origin: location.origin, title: document.title, ready: document.documentElement.dataset.desktopReady === 'true', nodeUnavailable: typeof require === 'undefined', apiStatus: response.status, apiCode: result.code };
  })()`);
  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reloaded;
  const persisted = await window.webContents.executeJavaScript("localStorage.getItem('droplab.desktop.smoke') === 'persists'");
  const prefs = window.webContents.getLastWebPreferences();
  const passed = first.origin === APP_ORIGIN && first.ready && first.nodeUnavailable && first.apiStatus === 400 && first.apiCode === 'token_required' && persisted && prefs.contextIsolation && prefs.sandbox && !prefs.nodeIntegration;
  console.log(JSON.stringify({ desktopSmoke: passed ? 'passed' : 'failed', ...first, persistentStorage: persisted, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox }));
  app.exit(passed ? 0 : 1);
}

async function createWindow() {
  const appRoot = applicationRoot();
  const rendererRoot = fs.existsSync(path.join(appRoot, 'renderer', 'index.html'))
    ? path.join(appRoot, 'renderer') : path.join(appRoot, 'desktop/app/renderer');
  if (!fs.existsSync(path.join(rendererRoot, 'index.html'))) throw new Error('Build the desktop renderer before launching DropLab.');
  const handle = createProtocolHandler({ rendererRoot, version: app.getVersion(),
    discoveryAction: async input => (await providerModules())[0].discoveryAction(input),
    researchAction: async input => (await providerModules())[1].researchAction(input),
  });
  await protocol.handle('droplab', handle);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  mainWindow = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1050, minHeight: 650, show: !smokeMode,
    title: 'DropLab', backgroundColor: '#f5f8fc', autoHideMenuBar: true,
    icon: path.join(__dirname, app.isPackaged ? 'icon.png' : 'assets/icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, devTools: !app.isPackaged, spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalURL(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppURL(url)) { event.preventDefault(); if (isAllowedExternalURL(url)) void shell.openExternal(url); }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  configureMenu();
  await mainWindow.loadURL(`${APP_ORIGIN}/`);
  if (smokeMode) await smokeTest(mainWindow);
}

if (hasInstanceLock) app.whenReady().then(createWindow).catch(error => {
  if (smokeMode) { console.error(JSON.stringify({ desktopSmoke: 'failed', message: error.message })); app.exit(1); }
  else { dialog.showErrorBox('DropLab could not start', 'The bundled application could not load. Please extract the complete ZIP and launch DropLab.exe again.'); app.exit(1); }
});
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
app.on('window-all-closed', () => app.quit());
