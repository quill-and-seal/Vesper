// Capture une page du banc d'essai : node tests/browser/shot.mjs page.html?query sortie.png
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright-core");
const [pageUrl, out] = process.argv.slice(2);
const root = resolve(new URL("../..", import.meta.url).pathname);
const types = { ".js": "text/javascript", ".html": "text/html", ".wav": "audio/wav", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(root)) throw new Error();
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${server.address().port}/tests/browser/${pageUrl}`);
const done = await page.waitForFunction(() => window.__done, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch((e) => {
  console.error("ERREURS", errors);
  throw e;
});
await page.screenshot({ path: out });
console.log(JSON.stringify(done), errors.length ? errors : "");
await browser.close(); server.close();
