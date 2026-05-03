# GladiosWAF Integration Guide

> Autonomous Web Application Firewall (AI-powered) — Drop-in protection for modern apps

GladiosWAF inspects incoming HTTP requests using a machine-learning classifier and blocks those flagged as malicious.

GladiosWAF is **application-agnostic**: it exposes a standard HTTPS API, so it can be integrated with any backend stack — Node.js, Python, Go, Java, .NET, Ruby, PHP, or any platform capable of making outbound HTTP requests. It can also be invoked from API gateways, reverse proxies, serverless functions, or service meshes.

This guide uses **Node.js with Express middleware** as a worked example because it's a common starting point, but the same patterns translate directly to other stacks. The core integration is always the same: forward the incoming request to the GladiosWAF endpoint, inspect the response status (`200` = safe, `403` = malicious), and decide whether to allow or block. See the [FAQ](#faq) for notes on adapting this guide to other frameworks.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Configuration](#configuration)
5. [Full Middleware Implementation](#full-middleware-implementation)
6. [Using the Middleware in Express Routes](#using-the-middleware-in-express-routes)
7. [Sanitizing Forwarded Data](#sanitizing-forwarded-data)
8. [API Reference](#api-reference)
9. [Error Handling & Fail Strategies](#error-handling--fail-strategies)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)
12. [FAQ](#faq)

---

## Overview

GladiosWAF acts as a pre-processing layer in your Express request pipeline. Every incoming `POST` and `PUT` request is forwarded to the GladiosWAF ML endpoint for classification before reaching your application logic. The ML endpoint signals its verdict via HTTP status code:

- **`200 OK`** — request is non-malicious; allow it through
- **`403 Forbidden`** — request is malicious; block it

**Request flow:**

```
Client → Express App → GladiosWAF Middleware → ML Endpoint
                              ↓
                     ┌────────┴────────┐
                  403 Forbidden     200 OK
                     ↓                 ↓
                Block request    next() → Route Handler
```

---

## Prerequisites

- Node.js 18+ (for native `fetch` and modern async support)
- An Express application (v4 or v5)
- A GladiosWAF API key (see [Obtaining an API Key](#obtaining-an-api-key) below)
- `axios` installed:

```bash
npm install axios
```

### Obtaining an API Key

To create an API key:

1. **Log in** to your GladiosWAF account.
2. Navigate to the **API Key** section from the dashboard.
3. Click **Create API Key**.
4. Copy the generated key and store it securely — for security reasons, the full key is typically only shown once at creation time.

Treat your API key like a password:

- Never commit it to source control. Use environment variables or a secret manager (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager, etc.).
- Rotate keys periodically and immediately if you suspect a leak.
- Use separate keys for development, staging, and production environments so you can revoke one without affecting the others.

### Authenticating Requests

Every request to the GladiosWAF ML endpoint must include your API key in the **`gladioswaf-apikey`** request header.

```http
POST /api/mlendpoint HTTP/1.1
Host: www.somedomain.com
Content-Type: application/json
gladioswaf-apikey: your-api-key-here
```

**Important details:**

- The header name is exactly `gladioswaf-apikey` — all lowercase, with a hyphen between `gladioswaf` and `apikey`. HTTP header names are case-insensitive, but stick with lowercase for consistency across tools and logs.
- Do **not** use common alternatives like `Authorization`, `X-API-Key`, `apikey`, or `api-key` — these will not be recognized and will result in a `401 Unauthorized` response.
- The key is sent as the **raw value** of the header. Do not prefix it with `Bearer`, `Token`, or any other scheme.

**Examples in different tools:**

```javascript
// axios
axios.post(ML_API_URL, body, {
  headers: { 'gladioswaf-apikey': process.env.GLADIOSWAF_API_KEY }
});
```

```javascript
// fetch
fetch(ML_API_URL, {
  method: 'POST',
  headers: { 'gladioswaf-apikey': process.env.GLADIOSWAF_API_KEY },
  body: JSON.stringify(body)
});
```

```bash
# curl
curl -X POST https://www.somedomain.com/api/mlendpoint \
  -H "gladioswaf-apikey: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"key":"value"}'
```

---

## Quick Start

### 1. Set environment variables

Create or update your `.env` file:

```bash
GLADIOSWAF_API_URL=https://ml.gladioswaf.ai
GLADIOSWAF_API_KEY=your-api-key-here
```

### 2. Add the middleware - you can use fetch or axios

```javascript
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const ML_API_URL = process.env.GLADIOSWAF_API_URL;
const API_KEY = process.env.GLADIOSWAF_API_KEY;

app.use(async (req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return next();
  }

  // Optionally removing the sensitive
  const headersToForward = { ...req.headers };
  delete headersToForward.host;
  delete headersToForward.connection;
  delete headersToForward['content-length'];
  headersToForward['gladioswaf-apikey'] = API_KEY;

  try {
    const mlResponse = await axios({
      method: req.method.toLowerCase(),
      url: ML_API_URL,
      params: req.query,
      headers: headersToForward,
      data: req.body,
      timeout: 5000,
      // Treat 200 and 403 as expected responses; anything else is an error
      validateStatus: (status) => status === 200 || status === 403
    });

    if (mlResponse.status === 403) {
      return res.status(403).json({ error: 'Blocked By AI-WAF' });
    }

    return next();
  } catch (err) {
    console.error('GladiosWAF error:', err.message);
    return next(); // fail-open (see Fail Strategies below)
  }
});

// Your routes go here
app.post('/api/login', (req, res) => res.json({ ok: true }));

app.listen(3000);
```

That's it — your `POST` and `PUT` routes are now protected.

---

## Configuration

| Variable | Description | Default |
|---|---|---|
| `GLADIOSWAF_API_URL` | The ML endpoint URL | _[TODO: production URL]_ |
| `GLADIOSWAF_API_KEY` | Your customer API key | _(required)_ |
| `GLADIOSWAF_TIMEOUT_MS` | Request timeout to the ML endpoint | `5000` |
| `GLADIOSWAF_FAIL_MODE` | `open` (allow on error) or `closed` (block on error) | `open` |

### Authentication header

The API key must be sent in the `gladioswaf-apikey` header (all lowercase, hyphenated). See [Authenticating Requests](#authenticating-requests) for full details.

### Middleware options

These are passed when invoking `gladiosWAF({ ... })`:

| Option | Type | Description |
|---|---|---|
| `methods` | `string[]` | HTTP methods to inspect. Default: `['POST', 'PUT']` |
| `stripHeaders` | `string[]` | Header names to remove before forwarding |
| `stripCookies` | `string[]` | Cookie names to remove from the `Cookie` header |
| `stripBodyFields` | `string[]` | Body fields to remove (dot-notation) |
| `transformBody` | `function` | Async transform applied to body before forwarding |

See [Sanitizing Forwarded Data](#sanitizing-forwarded-data) for usage.

---

## Full Middleware Implementation

Below is a production-ready version with timeout, configurable fail mode, header/cookie/body sanitization, and structured logging.

```javascript
// gladioswaf.js
const axios = require('axios');

const ML_API_URL = process.env.GLADIOSWAF_API_URL;
const API_KEY = process.env.GLADIOSWAF_API_KEY;
const TIMEOUT_MS = parseInt(process.env.GLADIOSWAF_TIMEOUT_MS, 10) || 5000;
const FAIL_MODE = process.env.GLADIOSWAF_FAIL_MODE || 'open';

// Headers that should never be forwarded — they describe the hop, not the request
const HOP_HEADERS = ['host', 'connection', 'content-length', 'api-keys'];

function buildForwardHeaders(reqHeaders, stripHeaders = []) {
  const headers = { ...reqHeaders };
  const toStrip = [...HOP_HEADERS, ...stripHeaders.map((h) => h.toLowerCase())];
  for (const h of toStrip) {
    delete headers[h];
  }
  headers['gladioswaf-apikey'] = API_KEY;
  return headers;
}

function stripCookies(cookieHeader, stripCookies = []) {
  if (!cookieHeader || stripCookies.length === 0) return cookieHeader;
  const stripSet = new Set(stripCookies);
  return cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter((c) => {
      const name = c.split('=')[0];
      return !stripSet.has(name);
    })
    .join('; ');
}

function stripBodyFields(body, stripFields = []) {
  if (!body || typeof body !== 'object' || stripFields.length === 0) return body;
  const clone = JSON.parse(JSON.stringify(body)); // deep clone
  for (const path of stripFields) {
    deletePath(clone, path);
  }
  return clone;
}

// Deletes a dot-notation path from an object, e.g. 'user.password' or 'creditCard.cvv'
function deletePath(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    current = current[parts[i]];
  }
  if (current && typeof current === 'object') {
    delete current[parts[parts.length - 1]];
  }
}

function gladiosWAF(options = {}) {
  const {
    methods = ['POST', 'PUT'],
    stripHeaders = [],
    stripCookies: stripCookieList = [],
    stripBodyFields: stripBodyList = [],
    transformBody // optional async (body, req) => sanitizedBody
  } = options;

  return async function (req, res, next) {
    if (!methods.includes(req.method)) {
      return next();
    }

    // 1. Sanitize headers
    const headersToForward = buildForwardHeaders(req.headers, stripHeaders);

    // 2. Sanitize cookies
    if (headersToForward.cookie) {
      headersToForward.cookie = stripCookies(headersToForward.cookie, stripCookieList);
      if (!headersToForward.cookie) delete headersToForward.cookie;
    }

    // 3. Sanitize body
    let bodyToForward = stripBodyFields(req.body, stripBodyList);
    if (typeof transformBody === 'function') {
      bodyToForward = await transformBody(bodyToForward, req);
    }

    try {
      const mlResponse = await axios({
        method: req.method.toLowerCase(),
        url: ML_API_URL,
        params: req.query,
        headers: headersToForward,
        data: bodyToForward,
        timeout: TIMEOUT_MS,
        // 200 = safe, 403 = malicious. Both are expected; don't throw.
        validateStatus: (status) => status === 200 || status === 403
      });

      if (mlResponse.status === 403) {
        console.warn('[GladiosWAF] Blocked request', {
          path: req.path,
          ip: req.ip,
          body: mlResponse.data // [TODO: confirm what (if anything) the 403 response body contains]
        });
        return res.status(403).json({ error: 'Blocked By AI-WAF' });
      }

      return next();
    } catch (err) {
      console.error('[GladiosWAF] Inspection failed', {
        path: req.path,
        error: err.message,
        status: err.response?.status
      });

      if (FAIL_MODE === 'closed') {
        return res.status(503).json({ error: 'WAF unavailable' });
      }
      return next();
    }
  };
}

module.exports = gladiosWAF;
```

**Usage:**

```javascript
const express = require('express');
const gladiosWAF = require('./gladioswaf');

const app = express();
app.use(express.json());

app.use(gladiosWAF({
  stripHeaders: ['authorization', 'x-internal-token'],
  stripCookies: ['session', 'csrf_token'],
  stripBodyFields: ['password', 'creditCard.cvv', 'user.ssn']
}));
```

---

## Using the Middleware in Express Routes

Express middleware can be mounted at four different scopes. GladiosWAF works at any of them — the right choice depends on which routes need protection.

### Scope reference

| Scope | What it protects | When to use |
|---|---|---|
| **Application-level** (`app.use(...)`) | Every route in the app | You want WAF on everything; simple apps |
| **Path-prefixed** (`app.use('/api', ...)`) | All routes under a prefix | Public site doesn't need WAF, but `/api/*` does |
| **Router-level** (`router.use(...)`) | All routes on a specific router | Modular apps with feature-based routers |
| **Route-level** (`app.post('/x', wafMW, handler)`) | One specific route | Surgical protection for sensitive endpoints |

### Middleware order matters

GladiosWAF must be mounted **after** body parsers (so `req.body` is populated) and **before** route handlers and auth middleware (so malicious requests are rejected before doing expensive work or exposing protected logic).

```javascript
const express = require('express');
const cookieParser = require('cookie-parser');
const gladiosWAF = require('./gladioswaf');

const app = express();

// 1. Body parsers — must come first so req.body is populated
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 2. GladiosWAF — inspects the parsed body
app.use(gladiosWAF());

// 3. Authentication, rate limiting, etc.
app.use(authMiddleware);

// 4. Route handlers
app.use('/api', apiRouter);
```

### Application-level (protect everything)

The simplest setup — every `POST` and `PUT` to your app gets inspected:

```javascript
const app = express();

app.use(express.json());
app.use(gladiosWAF());

app.post('/api/login', loginHandler);
app.post('/api/comments', createCommentHandler);
app.put('/api/users/:id', updateUserHandler);
```

### Path-prefixed (protect a subtree)

Common pattern: protect your API routes but skip static files, health checks, and webhooks:

```javascript
const app = express();

app.use(express.json());

// Public routes — no WAF
app.get('/health', (req, res) => res.send('ok'));
app.use('/static', express.static('public'));

// API routes — WAF applies
app.use('/api', gladiosWAF());

app.post('/api/login', loginHandler);   // protected
app.post('/api/comments', createComment); // protected
```

### Router-level (modular apps)

If you organize routes into separate router modules, mount the middleware on the router itself:

```javascript
// routes/users.js
const express = require('express');
const gladiosWAF = require('../gladioswaf');

const router = express.Router();

// All routes on this router are protected
router.use(gladiosWAF({
  stripBodyFields: ['password', 'currentPassword']
}));

router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
```

```javascript
// app.js
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter);
```

This keeps sanitization rules close to the routes they apply to.

### Route-level (single route)

Pass the middleware as an argument to a specific route handler. Useful when only one or two endpoints need protection (or need *different* protection from the rest):

```javascript
const wafForPayments = gladiosWAF({
  stripBodyFields: ['card.number', 'card.cvv'],
  stripHeaders: ['authorization']
});

// Only this route runs through GladiosWAF
app.post('/api/payments', wafForPayments, async (req, res) => {
  const result = await processPayment(req.body);
  res.json(result);
});

// Other routes are not inspected
app.post('/api/comments', createCommentHandler);
```

### Mixing strategies

Real apps usually combine scopes. A typical setup:

```javascript
const app = express();

app.use(express.json());

// Default WAF on all API routes — basic sanitization
app.use('/api', gladiosWAF({
  stripHeaders: ['authorization']
}));

// Override for sensitive routes — stricter sanitization
const wafStrict = gladiosWAF({
  stripHeaders: ['authorization', 'x-internal-token'],
  stripBodyFields: ['password', 'ssn', 'card.number', 'card.cvv']
});

app.post('/api/login', wafStrict, loginHandler);
app.post('/api/payments', wafStrict, paymentHandler);

// Standard routes use the default WAF from app.use above
app.post('/api/comments', createCommentHandler);
```

> **Note:** when you mount `gladiosWAF()` at `/api` *and* pass `wafStrict` to a specific route, **both run** — the request gets inspected twice. To avoid this, either mount the default WAF on a different path that excludes the strict routes, or skip the app-level mount and apply WAF at the route level only.

### Skipping the WAF on specific routes

If you've mounted GladiosWAF globally but need to exempt certain routes (health checks, webhooks from trusted sources, internal service calls), use a guard:

```javascript
const SKIP_PATHS = new Set(['/health', '/metrics', '/internal/webhook']);

app.use((req, res, next) => {
  if (SKIP_PATHS.has(req.path)) return next();
  return gladiosWAF()(req, res, next);
});
```

Or by header (e.g., for trusted internal services that present a shared secret):

```javascript
app.use((req, res, next) => {
  if (req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN) {
    return next();
  }
  return gladiosWAF()(req, res, next);
});
```

### Common mistakes

**Mounting before body parsers**
`req.body` will be `undefined` when GladiosWAF tries to forward it. Always mount `express.json()` first.

**Mounting after the route handler**
Express middleware runs in order. If GladiosWAF is registered after the route, it never runs for that route.

```javascript
// ❌ Wrong — handler runs before WAF can inspect
app.post('/api/login', loginHandler);
app.use(gladiosWAF());

// ✅ Right
app.use(gladiosWAF());
app.post('/api/login', loginHandler);
```

**Forgetting `return next()` in async handlers**
If the request is safe, the middleware must call `next()` to pass control to the next handler. The provided implementation handles this correctly, but if you write your own variant, don't forget it — otherwise the request hangs until it times out.

**Calling the middleware factory at the wrong time**
`gladiosWAF()` returns a middleware function. You must call it once when registering:

```javascript
// ❌ Wrong — passes the factory itself, not the middleware
app.use(gladiosWAF);

// ✅ Right — calls the factory to get the middleware
app.use(gladiosWAF());
```

---

## Sanitizing Forwarded Data

The middleware forwards a copy of the incoming request to the GladiosWAF ML endpoint for inspection. In many cases, you don't want to send everything — sensitive data should never leave your trust boundary, and trimming the payload reduces inspection latency and cost.

### Why sanitize?

- **Compliance** — regulations like GDPR, PDPA, HIPAA, and PCI-DSS restrict where personal or financial data can flow. Even if GladiosWAF is a trusted vendor, your Data Processing Agreement may require minimization.
- **Secret hygiene** — auth tokens, session cookies, and API keys add no value to threat classification but become liability if logs are ever breached.
- **Payload size** — large file uploads or base64 blobs slow down inspection without improving accuracy.
- **Signal quality** — irrelevant fields (long tracking IDs, legitimate user-supplied prose) can dilute the malicious patterns the model is looking for.

### What the middleware can sanitize

The middleware exposes four sanitization options, applied in order before the request is forwarded:

| Option | Type | Removes |
|---|---|---|
| `stripHeaders` | `string[]` | Named headers (case-insensitive) |
| `stripCookies` | `string[]` | Named cookies from the `Cookie` header |
| `stripBodyFields` | `string[]` | Body fields by dot-notation path |
| `transformBody` | `function` | Custom async transform on the body |

#### Stripping headers

Auth tokens, internal routing headers, and anything else the classifier shouldn't see:

```javascript
app.use(gladiosWAF({
  stripHeaders: ['authorization', 'x-api-token', 'x-user-id']
}));
```

> Note: `host`, `connection`, `content-length`, and `api-keys` are always stripped automatically — they are hop-by-hop headers that should never be forwarded.

#### Stripping cookies

Cookies are tricky because they all live inside a single `Cookie` header. The middleware parses the header, removes named cookies, and reassembles the rest:

```javascript
app.use(gladiosWAF({
  stripCookies: ['session', 'auth_token', 'csrf']
}));
```

If you want to drop cookies entirely, just include `cookie` in `stripHeaders` instead.

#### Stripping body fields

For JSON bodies, use dot-notation paths to remove specific fields without losing the rest of the payload:

```javascript
app.use(gladiosWAF({
  stripBodyFields: [
    'password',           // top-level field
    'user.ssn',           // nested field
    'payment.card.cvv'    // deeply nested
  ]
}));
```

Original body:
```json
{
  "username": "alice",
  "password": "hunter2",
  "user": { "name": "Alice", "ssn": "123-45-6789" }
}
```

Forwarded body:
```json
{
  "username": "alice",
  "user": { "name": "Alice" }
}
```

#### Custom transforms

For more complex sanitization — masking instead of deleting, redacting based on field content, truncating large fields — pass a `transformBody` function:

```javascript
app.use(gladiosWAF({
  transformBody: async (body, req) => {
    if (!body) return body;

    // Mask email addresses instead of removing them
    if (body.email) {
      body.email = body.email.replace(/(.).*(@.*)/, '$1***$2');
    }

    // Truncate long free-text fields
    if (body.description && body.description.length > 500) {
      body.description = body.description.slice(0, 500) + '...[truncated]';
    }

    return body;
  }
}));
```

The transform runs **after** `stripBodyFields`, so you can combine both.

### What you should always strip

At minimum, consider stripping these from every integration:

- **Authentication headers**: `authorization`, `x-api-key`, `cookie` (if cookies carry session tokens)
- **Password fields**: `password`, `currentPassword`, `newPassword`
- **Payment data**: full card numbers, CVV, bank account numbers
- **Government IDs**: SSN, NRIC, passport numbers, tax IDs
- **Health data**: diagnosis codes, prescription details (for HIPAA-regulated apps)

### What you should NOT strip

Don't over-sanitize — the classifier needs enough signal to detect attacks. Keep:

- **User-Agent and Referer headers** — useful for bot detection
- **Query parameters** — common injection vector
- **URL paths** — context for path traversal attacks
- **Field names** — even if you mask values, the structure helps the model
- **At least some body content** — an empty body gives the classifier nothing to work with

### Per-route sanitization

Different endpoints handle different data. Mount multiple instances:

```javascript
// Login endpoint — strip the password but keep everything else
app.use('/api/login', gladiosWAF({
  stripBodyFields: ['password']
}));

// Payment endpoint — strip card data
app.use('/api/payment', gladiosWAF({
  stripBodyFields: ['card.number', 'card.cvv', 'card.expiry']
}));

// Public endpoints — minimal stripping
app.use('/api/public', gladiosWAF());
```

---

## API Reference

### Endpoint

```
POST {GLADIOSWAF_API_URL}
```

### Request headers

| Header | Required | Description |
|---|---|---|
| `gladioswaf-apikey` | Yes | Your customer API key |
| `Content-Type` | Yes | `application/json` |

The middleware also forwards original request headers (excluding `host`, `connection`, `content-length`) so the classifier can inspect user-agent, cookies, etc.

### Request body

The forwarded request's original body. _[TODO: confirm — does the ML endpoint expect the raw body, or a wrapped envelope like `{ "method": "...", "path": "...", "body": {...} }`?]_

### Response

GladiosWAF signals its verdict via the HTTP status code:

| Status | Meaning |
|---|---|
| `200 OK` | Request is safe — proceed |
| `403 Forbidden` | Request is malicious — block |
| `401 Unauthorized` | Invalid or missing API key |
| `429 Too Many Requests` | Rate limit exceeded _[TODO: confirm limit, e.g., 1000 req/min]_ |
| `5xx` | GladiosWAF service error — apply fail strategy |

_[TODO: confirm whether the 200 and 403 responses include a body (e.g., confidence score, reason, request ID for support), or if they are empty.]_

### Important: configure your HTTP client to accept 403

Many HTTP clients (including `axios`) treat any non-2xx response as an error and throw. Since GladiosWAF uses `403` as a normal verdict — not an error — you must configure your client to accept it. With axios:

```javascript
validateStatus: (status) => status === 200 || status === 403
```

Without this, all malicious-verdict responses end up in your `catch` block alongside genuine network failures, making them indistinguishable.

---

## Error Handling & Fail Strategies

When the ML endpoint is unreachable (timeout, 5xx, network error), your middleware must decide: let the request through, or block it?

### Fail-open (default)

Allows requests through when GladiosWAF is unavailable. Prioritizes availability over security. Recommended for most consumer-facing applications.

```javascript
GLADIOSWAF_FAIL_MODE=open
```

### Fail-closed

Blocks all requests when GladiosWAF is unavailable. Prioritizes security over availability. Recommended for high-sensitivity endpoints (admin panels, payment flows).

```javascript
GLADIOSWAF_FAIL_MODE=closed
```

### Selective fail mode

You can mix strategies by mounting the middleware with different options on different routes:

```javascript
app.use('/api/public', gladiosWAF({ failMode: 'open' }));
app.use('/api/admin', gladiosWAF({ failMode: 'closed' }));
```

---

## Best Practices

**Store the API key in environment variables.** Never commit it to source control. Use a secret manager (AWS Secrets Manager, HashiCorp Vault, etc.) in production.

**Set a reasonable timeout.** A slow ML endpoint shouldn't stall your request pipeline. 3–5 seconds is a good starting point.

**Mount the middleware after body parsers** (`express.json()`, `express.urlencoded()`) so `req.body` is populated when GladiosWAF inspects it.

**Mount before authentication and route handlers** — you want to filter malicious traffic before doing expensive work like DB lookups.

**Log blocked requests** with enough context (path, IP, reason) for incident review, but avoid logging full request bodies if they may contain sensitive user data.

**Monitor false-positive rates.** If legitimate traffic gets blocked, capture the request signature and report it via _[TODO: support contact / feedback mechanism]_.

**Skip GladiosWAF for trusted internal traffic** (health checks, internal service-to-service calls) using a path or header check:

```javascript
app.use((req, res, next) => {
  if (req.path === '/health' || req.headers['x-internal'] === 'true') {
    return next();
  }
  return gladiosWAF()(req, res, next);
});
```

---

## Troubleshooting

**`401 Unauthorized` from the ML endpoint**
Your API key is missing or invalid. Confirm `GLADIOSWAF_API_KEY` is set and that the header name is exactly `gladioswaf-apikey`.

**Requests hang or time out**
Check network connectivity to `GLADIOSWAF_API_URL`. Lower the timeout if the endpoint is unreachable so your app fails fast.

**`req.body` is empty when forwarded**
You forgot to mount `express.json()` (or `express.urlencoded()`) before the GladiosWAF middleware.

**Legitimate requests being blocked**
Capture the request and submit it to _[TODO: support / feedback channel]_ for review and model retraining.

**Custom headers stripped by browser (CORS)**
If a frontend calls a backend that uses GladiosWAF, custom headers like `gladioswaf-apikey` should only be added server-side, not from the browser. Browsers will block them unless the destination server allows them in `Access-Control-Allow-Headers`.

---

## FAQ

**Does GladiosWAF inspect `GET` requests?**
Not by default — query parameters are usually safer than bodies, and inspecting every `GET` doubles your traffic. You can opt in by passing `{ methods: ['GET', 'POST', 'PUT'] }`.

**Can I use GladiosWAF with frameworks other than Express?**
Yes — GladiosWAF is a plain HTTPS API and is independent of any framework or language. The Express middleware pattern in this guide translates directly to:

- **Node.js**: Fastify hooks (`fastify.addHook('preHandler', ...)`), Koa middleware, NestJS guards or interceptors, Hapi extensions
- **Python**: Flask `before_request` hooks, Django middleware, FastAPI dependencies or middleware
- **Go**: `http.Handler` wrappers, Gin/Echo/Fiber middleware
- **Java/Kotlin**: Spring `OncePerRequestFilter`, servlet filters
- **.NET**: ASP.NET Core middleware (`app.Use(...)`)
- **Ruby**: Rack middleware, Rails `before_action` filters
- **PHP**: Laravel middleware, Symfony event listeners

You can also integrate GladiosWAF outside your application code — at an API gateway (Kong, Apigee, AWS API Gateway via Lambda authorizer), a reverse proxy (Nginx with `ngx_http_auth_request_module`, Envoy with an external auth filter), or a service mesh. The contract is always the same: forward the request, check the status code (`200` safe, `403` malicious), proceed or block.

**What's the latency overhead?**
Typically _[TODO: confirm with benchmark, e.g., 50–150ms p95]_ depending on payload size and region.

**Can I run GladiosWAF in shadow mode (log but don't block)?**
Yes — modify the middleware to log the verdict without returning `403`:

```javascript
if (mlResponse.status === 403) {
  console.warn('[GladiosWAF SHADOW] Would block', { path: req.path });
}
return next();
```

**Is the ML endpoint stateful?**
_[TODO: confirm — does the classifier maintain session context, or is each request inspected independently?]_

---

## Support

- Documentation: _[TODO: docs URL]_
- Support email: _[TODO: support@...]_
- Status page: _[TODO: status page URL]_
