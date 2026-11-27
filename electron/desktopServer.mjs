import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';

export const DEFAULT_DESKTOP_PORT = 4319;
export const DESKTOP_HOST = '127.0.0.1';

export function resolveDesktopPort(env = process.env) {
  const raw = env.PCC_DESKTOP_PORT;
  if (raw === undefined || raw === '') return DEFAULT_DESKTOP_PORT;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 65536) return parsed;
  return DEFAULT_DESKTOP_PORT;
}

export function isAllowedNavigationUrl(targetUrl, allowedOrigin) {
  try {
    return new URL(targetUrl).origin === allowedOrigin;
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function startDesktopServer({
  createApp,
  distDir,
  port = DEFAULT_DESKTOP_PORT,
  chatGptStoryLocalActivation = true,
}) {
  const app = createApp({ chatGptStoryLocalActivation });
  app.use(express.static(distDir));
  app.use((_req, res) => {
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Build output not found. Run "npm run build" first.');
    }
  });

  const httpServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      httpServer.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, DESKTOP_HOST);
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const origin = `http://${DESKTOP_HOST}:${actualPort}`;

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
    });
  };

  return { httpServer, port: actualPort, host: DESKTOP_HOST, origin, close };
}
