import type { Request, Response } from 'express';

export function portForRequest(req: Request): number {
  const explicit = Number(process.env.PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit < 65536) return explicit;
  const host = req.get('host') ?? '';
  const match = /:(\d+)$/.exec(host);
  return match ? Number(match[1]) : 3000;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const address = value.toLowerCase().replace(/^::ffff:/, '').split('%')[0];
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function isLoopbackHost(value: string | undefined): boolean {
  if (!value || value.includes('@')) return false;
  try {
    const parsed = new URL(`http://${value}`);
    const hasUnexpectedParts = Boolean(parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash);
    if (hasUnexpectedParts) return false;
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

function isTrustedLoopbackOrigin(origin: string, expectedHost?: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password) return false;
    if (!isLoopbackHost(parsed.host)) return false;
    return expectedHost === undefined || parsed.host === expectedHost;
  } catch {
    return false;
  }
}

export function hasSameOriginLocalRequest(req: Request): boolean {
  const host = req.get('host');
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHost(host)) return false;
  const origin = req.get('origin');
  if (origin) {
    if (!isTrustedLoopbackOrigin(origin, host)) return false;
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  const fetchSite = req.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}

export function requireLoopback(req: Request, res: Response, next: (error?: unknown) => void): void {
  if (!hasSameOriginLocalRequest(req)) {
    res.status(403).json({ error: { code: 'LOCAL_ONLY', message: 'Personal provider connections are only available from this local PCC instance.' } });
    return;
  }
  next();
}

export function requireLoopbackOAuthCallback(req: Request, res: Response, next: (error?: unknown) => void): void {
  const origin = req.get('origin');
  const validOrigin = !origin || isTrustedLoopbackOrigin(origin);
  if (req.method !== 'GET' || !isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHost(req.get('host')) || !validOrigin) {
    res.status(403).send('This authorization callback is only available to the local PCC process.');
    return;
  }
  next();
}
