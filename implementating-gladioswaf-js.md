```
import express from "express";
import gladiosWaf from "./gladiosWaf.js";

const app = express();
app.use(express.json());

app.use(
  gladiosWaf({
    apiUrl: "https://ml.gladioswaf.ai/ml-endpoint",
    apiKey: process.env.GLADIOSWAF_API_KEY,

    // Optional customization
    removeHeaders: ["cookie", "authorization"],
    failStrategy: "open", // or "closed"
  })
);

app.post("/login", (req, res) => {
  res.json({ ok: true });
});

app.listen(3000);

```
