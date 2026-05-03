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
    methods = ["POST", "PUT", "PATCH"],
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

  const methodsSet = new Set(methods.map((m) => m.toUpperCase()));

  return async function gladiosWafMiddleware(req, res, next) {
    if (!methodsSet.has(req.method.toUpperCase())) {
      return next();
    }

    const headersToForward = { ...req.headers };

    for (const header of DEFAULT_REMOVED_HEADERS) {
      delete headersToForward[header];
    }

    headersToForward[headerName] = apiKey;

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

      if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
          fetchOptions.body = req.body;
        } else {
          fetchOptions.body = JSON.stringify(req.body);
          headersToForward["content-type"] = "application/json";
        }
      }

      const wafResponse = await fetch(targetUrl.toString(), fetchOptions);

      if (wafResponse.status === 403) {
        return res.status(blockStatusCode).json(blockResponse);
      }

      if (wafResponse.ok) {
        return next();
      }

      throw new Error(`Unexpected GladiosWAF status: ${wafResponse.status}`);
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
