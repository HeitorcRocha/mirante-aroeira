// Teste de fumaça em navegador real. Usa o playwright-core já instalado e um
// navegador do sistema (Edge ou Chrome). Sem navegador, o teste se pula.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plans } from "../data/plans.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".json": "application/json",
};

let chromium = null, browser = null, server = null, base = "", motivoSkip = "";

before(async () => {
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    motivoSkip = "playwright-core não instalado";
    return;
  }
  for (const channel of ["msedge", "chrome"]) {
    try {
      browser = await chromium.launch({
        channel, headless: true,
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
      });
      break;
    } catch { /* tenta o próximo */ }
  }
  if (!browser) { motivoSkip = "nenhum navegador do sistema (Edge/Chrome) disponível"; return; }

  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

for (const p of plans) {
  test(`navegador: tour.html?planta=${p.id} abre sem erro, alterna para Caminhar e navega pela lista`, { timeout: 60000 }, async (t) => {
    if (!browser) return t.skip(motivoSkip);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const problemas = [];
    page.on("console", (m) => { if (m.type() === "error") problemas.push(`console.error: ${m.text()}`); });
    page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => problemas.push(`requestfailed: ${r.url()}`));
    page.on("response", (r) => { if (r.status() >= 400) problemas.push(`HTTP ${r.status()}: ${r.url()}`); });
    try {
      await page.goto(`${base}/tour.html?planta=${p.id}`, { waitUntil: "load" });
      // sem WebGL o tour mostra o plano B; isso não é um erro do código, então pula
      await page.waitForFunction(() => document.querySelector("#t-rooms button") || !document.querySelector("#t-fallback").hidden, null, { timeout: 15000 });
      if (await page.locator("#t-fallback").isVisible()) return t.skip("este navegador não tem WebGL (swiftshader indisponível)");

      assert.equal(await page.locator("#t-planta").inputValue(), p.id);
      assert.match(await page.title(), new RegExp(p.title));
      const botoes = page.locator("#t-rooms button");
      assert.equal(await botoes.count(), p.rooms.length + 1, "lista = Apartamento inteiro + cômodos");

      await page.click("#t-mode-caminhar");
      await page.waitForFunction(() => document.body.dataset.mode === "caminhar");
      assert.equal(await page.getAttribute("#t-mode-caminhar", "aria-pressed"), "true");
      assert.equal(await page.getAttribute("#t-mode-maquete", "aria-pressed"), "false");
      await page.waitForTimeout(1500);                        // voo de entrada

      const ultimo = botoes.nth(p.rooms.length);
      const nome = p.rooms[p.rooms.length - 1].full;
      await ultimo.click();
      await page.waitForFunction((i) => document.querySelector(`#t-rooms button[data-room="${i}"]`)?.getAttribute("aria-current") === "true",
        p.rooms.length - 1, { timeout: 20000 }).catch(() => { throw new Error(`"${nome}" não ficou como ambiente atual depois do clique`); });

      await page.click("#t-mode-maquete");
      await page.waitForFunction(() => document.body.dataset.mode === "maquete");

      const canvas = await page.locator("#t-canvas").boundingBox();
      assert.ok(canvas && canvas.width > 100 && canvas.height > 100, "canvas sem tamanho");
    } finally {
      await ctx.close();
    }
    assert.deepEqual(problemas, [], `problemas no navegador:\n${problemas.join("\n")}`);
  });
}
