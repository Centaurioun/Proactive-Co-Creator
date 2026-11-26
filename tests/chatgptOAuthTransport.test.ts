import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener, type Server } from 'node:http';
import { fetchBoundedHttpBody } from '../server/http.ts';

async function withServer(handler: RequestListener, run: (url: string, server: Server) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local test server did not bind a TCP port.');
  try { await run(`http://127.0.0.1:${address.port}`, server); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('OAuth transport reads a real HTTP response body before aborting its request signal', async () => {
  await withServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"issuer":');
    setTimeout(() => response.end('"local-test"}'), 30);
  }, async url => {
    const result = await fetchBoundedHttpBody(fetch, `${url}/discovery`, {}, { timeoutMs: 500, maxBodyBytes: 128 });
    assert.equal(result.ok, true);
    assert.equal(result.body, '{"issuer":"local-test"}');
  });
});

test('OAuth transport aborts a stalled real HTTP response body within its deadline', async () => {
  let connectionClosed = false;
  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"partial":');
    response.on('close', () => { if (!response.writableEnded) connectionClosed = true; });
  }, async url => {
    await assert.rejects(
      fetchBoundedHttpBody(fetch, `${url}/slow`, {}, { timeoutMs: 40, maxBodyBytes: 128 }),
      /timed out/i,
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(connectionClosed, true);
  });
});

test('OAuth transport rejects redirects without forwarding a credential-bearing request', async () => {
  let destinationCalls = 0;
  await withServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/destination' }).end();
      return;
    }
    destinationCalls += 1;
    response.end('{}');
  }, async url => {
    await assert.rejects(fetchBoundedHttpBody(fetch, `${url}/redirect`, {
      method: 'POST', body: 'token=sensitive', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }, { timeoutMs: 500, maxBodyBytes: 128 }));
    assert.equal(destinationCalls, 0);
  });
});
