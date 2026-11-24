import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { disableViteHmrClientPlugin } from '../vite.config.ts';

const ROOT = process.cwd();

function collectSourceFiles(relDirs: string[]): string[] {
  const results: string[] = [];
  for (const dir of relDirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const fullPath = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectSourceFiles([path.join(dir, entry.name)]));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe('security & Node 22 native execution compatibility', () => {
  it('ensures client source files never reference @google/genai, GEMINI_API_KEY, API_KEY, or window.aistudio', () => {
    const clientFiles = [
      path.join(ROOT, 'App.tsx'),
      ...collectSourceFiles(['components', 'services', 'lib']),
    ];

    for (const filePath of clientFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(content.includes('@google/genai'), false, `${filePath} must not import @google/genai`);
      assert.equal(content.includes('GEMINI_API_KEY'), false, `${filePath} must not reference GEMINI_API_KEY`);
      assert.equal(content.includes('process.env.API_KEY'), false, `${filePath} must not reference process.env.API_KEY`);
      assert.equal(content.includes('window.aistudio'), false, `${filePath} must not use window.aistudio`);
    }
  });

  it('imports server.ts cleanly under plain Node 22 without tsx', () => {
    const output = execFileSync(
      process.execPath,
      ['-e', 'import("./server.ts").then(m => console.log(typeof m.createApp))'],
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    assert.equal(output, 'function');
  });

  it('skips the installed Vite client WebSocket connection when DISABLE_HMR=true', () => {
    assert.equal(disableViteHmrClientPlugin(false), null);
    const plugin = disableViteHmrClientPlugin(true);
    assert.ok(plugin?.transform);

    const viteEntry = fileURLToPath(import.meta.resolve('vite'));
    const viteClientPath = path.resolve(path.dirname(viteEntry), '../client/client.mjs');
    const installedClientCode = fs.readFileSync(viteClientPath, 'utf8');
    assert.ok(
      installedClientCode.includes('transport.connect(createHMRHandler(handleMessage));'),
      `Installed Vite client no longer has the expected connection call: ${viteClientPath}`
    );

    const transform = plugin.transform as (
      this: unknown,
      code: string,
      id: string
    ) => { code: string; map: null } | null;
    assert.equal(transform.call({}, installedClientCode, '/app/src/App.tsx'), null);

    const transformed = transform.call({}, installedClientCode, viteClientPath);
    assert.ok(transformed?.code.includes('HMR disabled (DISABLE_HMR=true)'));
    assert.equal(
      transformed?.code.includes('transport.connect(createHMRHandler(handleMessage));'),
      false
    );
  });

});
