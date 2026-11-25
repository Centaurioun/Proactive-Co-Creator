import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const VITE_CLIENT_CONNECT_CALL = 'transport.connect(createHMRHandler(handleMessage));';
const projectDir = import.meta.dirname;

export function disableViteHmrClientPlugin(disableHmr: boolean): Plugin | null {
  if (!disableHmr) {
    return null;
  }

  return {
    name: 'disable-vite-hmr-client',
    enforce: 'post',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.endsWith('/vite/dist/client/client.mjs')) {
        return null;
      }
      if (!code.includes(VITE_CLIENT_CONNECT_CALL)) {
        return null;
      }
      return {
        code: code.replace(
          VITE_CLIENT_CONNECT_CALL,
          '/* HMR disabled (DISABLE_HMR=true): WebSocket connection skipped */'
        ),
        map: null,
      };
    },
  };
}

export default defineConfig(() => {
  const disableHmr = process.env.DISABLE_HMR === 'true';
  const noHmrPlugin = disableViteHmrClientPlugin(disableHmr);

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      ...(disableHmr ? { hmr: false as const, ws: false as const } : {}),
    },
    plugins: [react(), tailwindcss(), ...(noHmrPlugin ? [noHmrPlugin] : [])],
    resolve: {
      alias: {
        '@': path.resolve(projectDir, '.'),
      },
    },
  };
});

