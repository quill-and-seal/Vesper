// Lance le banc d'essai dans Chromium headless : node tests/browser/run.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright-core");

const root = resolve(new URL("../..", import.meta.url).pathname);
const types = { ".js": "text/javascript", ".html": "text/html", ".wav": "audio/wav", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(root)) throw new Error("hors racine");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ["--autoplay-policy=no-user-gesture-required", "--no-proxy-server"]
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// Fichiers attendus absents : le faux « x.ogg » du test de fenêtre et l'icône de page
const expected404 = /\/(x\.ogg|favicon\.ico)$/;
page.on("response", (r) => r.status() >= 400 && !expected404.test(new URL(r.url()).pathname) && errors.push(`${r.status()} ${r.url()}`));
await page.goto(`http://localhost:${port}/tests/browser/harness.html`);
const done = await page.waitForFunction(() => window.__done, null, { timeout: 120000 }).then((h) => h.jsonValue());
console.log(JSON.stringify(done, null, 1));
if (errors.length) console.log("ERREURS :", errors);
await browser.close();
server.close();
process.exit(done.ok && !errors.length ? 0 : 1);
