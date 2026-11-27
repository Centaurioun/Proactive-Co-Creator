import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.ts';
import {
  DEFAULT_DESKTOP_PORT,
  isAllowedNavigationUrl,
  isSafeExternalUrl,
  resolveDesktopPort,
  startDesktopServer,
} from '../electron/desktopServer.mjs';

test('desktopServer helpers enforce loopback origin and https-only external links', () => {
  assert.equal(resolveDesktopPort({}), DEFAULT_DESKTOP_PORT);
  assert.equal(resolveDesktopPort({ PCC_DESKTOP_PORT: '4399' }), 4399);
  assert.equal(resolveDesktopPort({ PCC_DESKTOP_PORT: 'invalid' }), DEFAULT_DESKTOP_PORT);

  assert.equal(isAllowedNavigationUrl('http://127.0.0.1:4319/app', 'http://127.0.0.1:4319'), true);
  assert.equal(isAllowedNavigationUrl('http://127.0.0.1:4311/', 'http://127.0.0.1:4319'), false);
  assert.equal(isAllowedNavigationUrl('https://example.com', 'http://127.0.0.1:4319'), false);

  assert.equal(isSafeExternalUrl('https://openai.com/auth'), true);
  assert.equal(isSafeExternalUrl('http://example.com'), false);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});

test('startDesktopServer binds strictly to 127.0.0.1, serves static dist, and shuts down cleanly', async () => {
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-desktop-dist-'));
  fs.writeFileSync(path.join(tmpDist, 'index.html'), '<!doctype html><html><body>PCC Desktop</body></html>');

  const srv = await startDesktopServer({
    createApp,
    distDir: tmpDist,
    port: 0,
    chatGptStoryLocalActivation: true,
  });

  try {
    assert.equal(srv.host, '127.0.0.1');
    assert.ok(srv.port > 0);
    const htmlRes = await fetch(srv.origin);
    assert.equal(htmlRes.status, 200);
    assert.match(await htmlRes.text(), /PCC Desktop/);

    const statusRes = await fetch(`${srv.origin}/api/health`);
    assert.equal(statusRes.status, 200);
    const body = await statusRes.json();
    assert.equal(typeof body.configured, 'boolean');
  } finally {
    await srv.close();
    fs.rmSync(tmpDist, { recursive: true, force: true });
  }
});
