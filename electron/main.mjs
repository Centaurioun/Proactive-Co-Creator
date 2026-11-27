import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { createApp } from '../dist-electron/server.mjs';
import {
  isAllowedNavigationUrl,
  isSafeExternalUrl,
  resolveDesktopPort,
  startDesktopServer,
} from './desktopServer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.setName('Proactive Co-Creator');

let mainWindow = null;
let desktopServer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function createMainWindow(origin) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'Proactive Co-Creator',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationUrl(url, origin)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
          },
        },
      };
    }
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('did-create-window', (childWin) => {
    const cleanupTimer = globalThis.setTimeout(() => {
      if (!childWin.isDestroyed()) childWin.close();
    }, 15_000);

    childWin.on('closed', () => {
      globalThis.clearTimeout(cleanupTimer);
    });

    childWin.webContents.on('will-navigate', (event, targetUrl) => {
      event.preventDefault();
      if (isSafeExternalUrl(targetUrl)) {
        void shell.openExternal(targetUrl);
      }
      if (!childWin.isDestroyed()) childWin.close();
    });
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  await win.loadURL(origin);
  return win;
}

async function boot() {
  if (!gotLock) return;
  const distDir = path.join(app.getAppPath(), 'dist');
  const port = resolveDesktopPort(process.env);
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'production';

  try {
    desktopServer = await startDesktopServer({
      createApp,
      distDir,
      port,
      chatGptStoryLocalActivation: true,
    });
  } catch (err) {
    dialog.showErrorBox(
      'Proactive Co-Creator failed to start',
      `Could not start the local loopback server on 127.0.0.1:${port}.\n\n${err instanceof Error ? err.message : String(err)}`
    );
    app.quit();
    return;
  }

  mainWindow = await createMainWindow(desktopServer.origin);
}

app.whenReady().then(boot).catch((err) => {
  console.error('Desktop boot failed:', err);
  app.quit();
});

app.on('before-quit', () => {
  if (desktopServer) {
    void desktopServer.close();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
