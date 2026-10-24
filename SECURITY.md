# Credential boundary

Server API keys must never be embedded in browser JavaScript, even for local previews. The Vite definitions for GEMINI_API_KEY/API_KEY intentionally resolve to undefined. Client features that depended on those credentials require migration to an authenticated server endpoint; this change does not implement that endpoint. Keep keys in the server environment, validate users, limit requests and spending, and return only model output. Never expose a general unauthenticated proxy.

If an earlier build used a real server key, revoke it at its provider and rebuild/redeploy. A source fix cannot erase already published bundles or revoke credentials. Browser-specific public keys need provider restrictions and are a separate case.

API previews bind to loopback and reject foreign Host/Origin headers. Public hosting requires authentication and authorization, spending limits, and HTTPS. Do not bypass this guard by rewriting untrusted requests to a localhost Host. WebSocket previews require a matching Origin too. This guard is not public-service user authentication.
