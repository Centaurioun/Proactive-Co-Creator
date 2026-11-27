import { build } from 'vite';

await build({
  configFile: false,
  build: {
    ssr: 'server.ts',
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'server.mjs',
      },
    },
  },
});

console.log('Built dist-electron/server.mjs');
