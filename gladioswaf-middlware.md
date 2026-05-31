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
    removeDefaultHeaders = true,
    removeHeaders = [],
    timeout = 5000,
    failStrategy = "open",
    blockStatusCode = 403,
    blockResponse = { error: "Blocked by GladiosWAF" },
    onError,
  } = options;

  if (!apiUrl) throw new Error("GladiosWAF: apiUrl is required.");
  if (!apiKey) throw new Error("GladiosWAF: apiKey is required.");

  const allowedMethods = new Set(methods.map((m) => m.toUpperCase()));

  const headersToRemove = new Set([
    ...(removeDefaultHeaders ? DEFAULT_REMOVED_HEADERS : []),
    ...removeHeaders.map((h) => h.toLowerCase()),
  ]);

  return async function gladiosWafMiddleware(req, res, next) {
    if (!allowedMethods.has(req.method.toUpperCase())) {
      return next();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers = { ...req.headers };

      for (const header of headersToRemove) {
        delete headers[header];
      }

      headers[headerName] = apiKey;
      headers["content-type"] = "application/json";

      const payload = {
        method: req.method,
        url: req.originalUrl || req.url,
        headers,
        body: req.body || {},
      };

      const wafResponse = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!wafResponse.ok) {
        throw new Error(`GladiosWAF returned ${wafResponse.status}`);
      }

      const decision = await wafResponse.json();

      req.gladioswaf = decision;

      const isMalicious =
        decision?.result?.toLowerCase() === "malicious" ||
        decision?.block === true;

      if (isMalicious) {
        return res.status(blockStatusCode).json(blockResponse);
      }

      return next();
    } catch (err) {
      if (typeof onError === "function") {
        onError(err, req);
      } else {
        console.error("GladiosWAF error:", err.message);
      }

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
