// Rend les modèles procéduraux en fichiers WAV et affiche leurs mesures :
//   node tools/render.mjs [dossier] [ids] [intensités] [secondes]
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright-core");

const [outDir = "renders", ids = "", intens = "", secs = "12"] = process.argv.slice(2);
const root = resolve(new URL("..", import.meta.url).pathname);
const types = { ".js": "text/javascript", ".html": "text/html" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(root)) throw new Error();
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-proxy-server"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const q = new URLSearchParams({ s: secs, ...(ids ? { ids } : {}), ...(intens ? { i: intens } : {}) });
await page.goto(`http://localhost:${server.address().port}/tools/render.html?${q}`);
const done = await page.waitForFunction(() => window.__done, null, { timeout: 300000 }).then((h) => h.jsonValue());
await browser.close();
server.close();
if (!done.ok) {
  console.error(done.error, errors);
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
for (const [key, { stats, wav }] of Object.entries(done.out)) {
  await writeFile(join(outDir, `${key.replace("@", "-")}.wav`), Buffer.from(wav, "base64"));
  console.log(key.padEnd(16), JSON.stringify(stats));
}
if (errors.length) console.log("ERREURS", errors);
