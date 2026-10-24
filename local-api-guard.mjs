// Local previews must not become unauthenticated public gateways for paid APIs.
export function isLocalRequest(req, portValue, requireOrigin = false) {
    const port = String(portValue);
    const host = String(req.headers.host || '').toLowerCase();
    const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
    if (!localHosts.has(host) || req.headers['sec-fetch-site'] === 'cross-site') {
      return false;
    }
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== host) {
          return false;
        }
      } catch { return false; }
    }
    return !requireOrigin || Boolean(req.headers.origin);
}
export function localApiOnly(getPort) {
  return (req, res, next) => {
    if (!isLocalRequest(req, getPort())) return res.status(403).json({error: 'This API is limited to local previews. Configure authentication before public hosting.'});
    next();
  };
}
