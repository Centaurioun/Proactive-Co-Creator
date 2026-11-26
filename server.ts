/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApiRouter, type ApiRouterOptions } from './server/routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(routerOptions: ApiRouterOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter(undefined, routerOptions));
  return app;
}

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const chatGptStoryLocalActivation =
    !isProd && process.env.PCC_CHATGPT_STORY_LOCAL_ACTIVATION === '1';
  const app = createApp({
    chatGptStoryLocalActivation,
  });
  const httpServer = http.createServer(app);
  const port = Number(process.env.PORT || 3000);
  const disableHmr = process.env.DISABLE_HMR === 'true';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(disableHmr ? { hmr: false as const, ws: false as const } : { ws: { server: httpServer } }),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run "npm run build" first.');
      }
    });
  }

  const host = chatGptStoryLocalActivation ? '127.0.0.1' : '0.0.0.0';
  httpServer.listen(port, host, () => {
    console.log(`Proactive Co-Creator server listening on http://${host}:${port}`);
  });
}

const isEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isEntryPoint) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
