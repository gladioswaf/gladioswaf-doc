```
import express from "express";
import gladiosWaf from "./gladiosWaf.js";

const app = express();

app.use(express.json());

app.use(
  gladiosWaf({
    apiUrl: "https://api.gladioswaf.ai/api/mlendpoint",
    apiKey: process.env.GLADIOSWAF_API_KEY,

    removeHeaders: [
      "cookie",
      "authorization",
      "x-internal-token",
    ],
  })
);

app.post("/login", (req, res) => {
  res.json({ ok: true, message: "Login route passed GladiosWAF" });
});

app.listen(3000, () => {
  console.log("App running on port 3000");
});


```
