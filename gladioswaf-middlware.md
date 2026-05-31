# This is the middleware e.g. gladioswaf.js 

```
const DEFAULT_REMOVED_HEADERS = [
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
];

export default function gladiosWaf(options = {}) {
  const {
    apiUrl,
    apiKey,
    headerName = "gladioswaf-apikey",
    methods = ["GET", "POST", "PUT", "DELETE", "PATCH"],
    removeHeaders = [],
    timeout = 5000,
    failStrategy = "open",
    blockStatusCode = 403,
    blockResponse = { error: "Blocked by GladiosWAF" },
    onError,
  } = options;

  if (!apiUrl) throw new Error("GladiosWAF: apiUrl is required.");
  if (!apiKey) throw new Error("GladiosWAF: apiKey is required.");

  const methodsSet = new Set(methods.map((m) => m.toUpperCase()));

  // Build once (performance + correctness)
  const headersToRemove = new Set([
    ...DEFAULT_REMOVED_HEADERS,
    ...removeHeaders.map((h) => h.toLowerCase()),
  ]);

  return async function gladiosWafMiddleware(req, res, next) {
    if (!methodsSet.has(req.method.toUpperCase())) {
      return next();
    }

    const headersToForward = { ...req.headers };

    // Remove headers (default + custom)
    for (const header of headersToRemove) {
      delete headersToForward[header];
    }

    // Inject API key
    headersToForward[headerName] = apiKey;

    // Build URL with query params
    const targetUrl = new URL(apiUrl);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (Array.isArray(value)) {
        value.forEach((v) => targetUrl.searchParams.append(key, String(v)));
      } else {
        targetUrl.searchParams.append(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions = {
        method: req.method,
        headers: headersToForward,
        signal: controller.signal,
      };

      // Attach body safely
      if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
          fetchOptions.body = req.body;
        } else {
          fetchOptions.body = JSON.stringify(req.body);
          headersToForward["content-type"] = "application/json";
        }
      }

      const wafResponse = await fetch(targetUrl.toString(), fetchOptions);

      // Block decision
      if (wafResponse.status === 403) {
        return res.status(blockStatusCode).json(blockResponse);
      }

      if (wafResponse.ok) {
        return next();
      }

      // Unexpected response
      throw new Error(`Unexpected GladiosWAF status: ${wafResponse.status}`);
    } catch (err) {
      if (typeof onError === "function") {
        onError(err, req);
      } else {
        console.error("GladiosWAF error:", err.message);
      }

      // Fail strategy
      if (failStrategy === "closed") {
        return res.status(503).json({
          error: "GladiosWAF unavailable",
        });
      }

      return next();
    } finally {
      clearTimeout(timer);
    }
  };
}

```
