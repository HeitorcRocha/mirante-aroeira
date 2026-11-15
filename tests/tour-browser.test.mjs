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

      // a lista fica fechada atrás do botão do ambiente atual
      const ultimo = botoes.nth(p.rooms.length);
      const nome = p.rooms[p.rooms.length - 1].full;
      await page.click("#t-rooms-btn");
      await ultimo.click();
      await page.waitForFunction((i) => document.querySelector(`#t-rooms button[data-room="${i}"]`)?.getAttribute("aria-current") === "true",
        p.rooms.length - 1, { timeout: 20000 }).catch(() => { throw new Error(`"${nome}" não ficou como ambiente atual depois do clique`); });
      // escolher um ambiente no caminhar sobe para a vista de topo dele, na maquete
      await page.waitForFunction(() => document.body.dataset.mode === "maquete");
      assert.equal(await page.locator("#t-rooms-name").innerText(), nome);

      const canvas = await page.locator("#t-canvas").boundingBox();
      assert.ok(canvas && canvas.width > 100 && canvas.height > 100, "canvas sem tamanho");
    } finally {
      await ctx.close();
    }
    assert.deepEqual(problemas, [], `problemas no navegador:\n${problemas.join("\n")}`);
  });
}

/* ------------------------------------- barra, vista de topo, mapa e luz -- */

// Abre o tour pronto para os testes de interação. Devolve null (e pula o
// teste) sem navegador ou sem WebGL.
async function abrir(t, id, viewport = { width: 1280, height: 800 }) {
  if (!browser) { t.skip(motivoSkip); return null; }
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const problemas = [];
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problemas.push(`console.error: ${m.text()}`); });
  await page.goto(`${base}/tour.html?planta=${id}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.MiranteTour || !document.querySelector("#t-fallback").hidden, null, { timeout: 15000 });
  if (await page.locator("#t-fallback").isVisible()) { await ctx.close(); t.skip("este navegador não tem WebGL"); return null; }
  return { ctx, page, problemas };
}
const ocioso = (page) => page.waitForFunction(() => window.MiranteTour.busy === false, null, { timeout: 20000 });
const camera = (page) => page.evaluate(() => window.MiranteTour.camera);
const roomCenter = (room) => {
  const xs = room.r.flatMap(([x, , w]) => [x, x + w]), ys = room.r.flatMap(([, y, , h]) => [y, y + h]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
// câmera de topo sobre o ambiente: olha para baixo, alvo no centro, alto da planta em cima
function assertTopo(cam, room, msg) {
  const [cx, cy] = roomCenter(room);
  assert.ok(cam.dir[1] < -0.999, `${msg}: câmera não olha reto para baixo (${cam.dir})`);
  assert.ok(Math.abs(cam.target[0] - cx) < 0.01 && Math.abs(cam.target[2] - cy) < 0.01, `${msg}: alvo ${cam.target} fora do centro ${[cx, cy]}`);
  assert.ok(Math.abs(cam.pos[0] - cx) < 0.05 && Math.abs(cam.pos[2] - cy) < 0.05, `${msg}: câmera fora do centro`);
  assert.ok(cam.pos[1] > 2.7, `${msg}: câmera abaixo do topo das paredes`);
  assert.ok(cam.pos[2] >= cam.target[2], `${msg}: câmera deveria estar do lado +Z (y = 0 da planta no alto da tela)`);
}

test("navegador: barra de ambientes abre e fecha (clique, Esc, clique fora, escolha)", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "dois-quartos");
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    const btn = page.locator("#t-rooms-btn"), lista = page.locator("#t-rooms");
    assert.equal(await btn.getAttribute("aria-expanded"), "false");
    assert.equal(await btn.getAttribute("aria-controls"), "t-rooms");
    assert.equal(await lista.isVisible(), false);
    assert.match(await btn.innerText(), /Apartamento inteiro\s+72 m²/);

    await btn.click();
    assert.equal(await btn.getAttribute("aria-expanded"), "true");
    assert.equal(await lista.isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await btn.getAttribute("aria-expanded"), "false");
    assert.equal(await lista.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "t-rooms-btn", "Esc devolve o foco ao botão");

    await btn.click();
    await page.mouse.click(5, 795);                          // canto do painel, fora da barra
    assert.equal(await btn.getAttribute("aria-expanded"), "false", "clique fora fecha");

    await btn.click();
    await page.click('#t-rooms button[data-room="5"]');
    assert.equal(await btn.getAttribute("aria-expanded"), "false", "escolher fecha");
    assert.equal(await page.evaluate(() => document.activeElement.id), "t-rooms-btn", "escolher devolve o foco ao botão");
    await page.waitForFunction(() => document.querySelector("#t-rooms-name").textContent === "Suíte");
    assert.equal(await page.locator("#t-rooms-m2").innerText(), "13,2 m²");
  } finally {
    await ctx.close();
  }
  assert.deepEqual(problemas, []);
});

test("navegador: escolher ambiente leva à vista de topo; o mini-mapa destaca o atual", { timeout: 60000 }, async (t) => {
  const p = plans.find((q) => q.id === "tres-suites");
  const s = await abrir(t, p.id);
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    assert.equal(await page.locator("#t-minimap path.minimap__room").count(), p.rooms.length);
    assert.equal(await page.locator("#t-minimap .is-current").count(), 0, "apartamento inteiro: nada destacado no mapa");

    for (const i of [1, 9, 0]) {
      await page.click("#t-rooms-btn");
      await page.click(`#t-rooms button[data-room="${i}"]`);
      await ocioso(page);
      assertTopo(await camera(page), p.rooms[i], p.rooms[i].full);
      await page.waitForFunction((i) => document.querySelector(`#t-minimap path.minimap__room[data-room="${i}"]`).classList.contains("is-current"), i);
      assert.equal(await page.locator("#t-minimap path.minimap__room.is-current").count(), 1);
      assert.equal(await page.locator(`#t-minimap path.minimap__outline.is-current[data-room="${i}"]`).count(), 1, "contorno também (não só cor)");
      assert.match(await page.locator("#t-minimap svg").getAttribute("aria-label"), new RegExp(`Ambiente atual: ${p.rooms[i].full}`));
    }

    // apartamento inteiro volta à vista 3/4 (não de topo) e apaga o destaque
    await page.click("#t-rooms-btn");
    await page.click('#t-rooms button[data-room="-1"]');
    await ocioso(page);
    assert.ok((await camera(page)).dir[1] > -0.99, "a vista inicial é inclinada, não de topo");
    await page.waitForFunction(() => document.querySelectorAll("#t-minimap .is-current").length === 0);
    assert.equal(await page.locator("#t-rooms-name").innerText(), "Apartamento inteiro");

    // clicar num ambiente do mini-mapa, na maquete, faz o mesmo que a lista
    await page.locator('#t-minimap path.minimap__room[data-room="12"]').click();
    await ocioso(page);
    assertTopo(await camera(page), p.rooms[12], "mini-mapa");
    await page.waitForFunction(() => document.querySelector("#t-rooms-name").textContent === "Suíte 3");

    // no caminhar, escolher na lista sai do caminhar e sobe para o topo do ambiente
    await page.click("#t-mode-caminhar");
    await ocioso(page);
    await page.click("#t-rooms-btn");
    await page.click('#t-rooms button[data-room="2"]');
    await page.waitForFunction(() => document.body.dataset.mode === "maquete");
    await ocioso(page);
    assertTopo(await camera(page), p.rooms[2], "caminhar -> lista");
    assert.equal(await page.getAttribute('#t-rooms button[data-room="2"]', "aria-current"), "true");
  } finally {
    await ctx.close();
  }
  assert.deepEqual(problemas, []);
});

test("navegador: no caminhar o mini-mapa mostra o visitante e clicar nele anda até o ambiente", { timeout: 60000 }, async (t) => {
  const p = plans.find((q) => q.id === "dois-quartos");
  const s = await abrir(t, p.id);
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    const eu = page.locator("#t-minimap .minimap__me");
    assert.equal(await eu.isVisible(), false, "sem marcador na maquete");
    await page.click("#t-mode-caminhar");
    await ocioso(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#t-minimap .minimap__me")).display !== "none");
    const [x, y] = await page.evaluate(() => window.MiranteTour.position);
    const cx = Number(await page.locator("#t-minimap .minimap__dot").getAttribute("cx"));
    const cy = Number(await page.locator("#t-minimap .minimap__dot").getAttribute("cy"));
    assert.ok(Math.abs(cx - x) < 0.06 && Math.abs(cy - y) < 0.06, `marcador (${cx}, ${cy}) longe da posição (${x}, ${y})`);
    assert.ok((await page.locator("#t-minimap .minimap__wedge").getAttribute("d")).startsWith("M"));

    // clique no meio do quarto (índice 7): anda até lá, sem sair do caminhar
    await page.locator('#t-minimap path.minimap__room[data-room="7"]').click();
    await ocioso(page);
    assert.equal(await page.evaluate(() => window.MiranteTour.mode), "caminhar");
    await page.waitForFunction(() => window.MiranteTour.room === 7, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#t-minimap path.minimap__room[data-room="7"]').classList.contains("is-current"));
    assert.equal(await page.locator("#t-rooms-name").innerText(), "Quarto");
  } finally {
    await ctx.close();
  }
  assert.deepEqual(problemas, []);
});

test("navegador: interruptor das luzes da casa e escolha da cor", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "studio");
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    const luz = page.locator("#t-lights"), branca = page.locator("#t-light-branca"), amarela = page.locator("#t-light-amarela");
    const estado = () => page.evaluate(() => window.MiranteTour.lights);
    assert.equal(await page.locator("#t-sun-h").innerText(), "Luz");
    assert.equal(await luz.getAttribute("aria-pressed"), "false", "começa apagada");
    assert.equal(await amarela.getAttribute("aria-pressed"), "true", "cor padrão: amarela");
    assert.equal(await branca.getAttribute("aria-pressed"), "false");
    const e0 = await estado();
    assert.equal(e0.on, false);
    assert.ok(e0.count > 0 && e0.count < 20, `${e0.count} luzes`);

    await luz.click();
    assert.equal(await luz.getAttribute("aria-pressed"), "true");
    assert.equal((await estado()).on, true);

    // a cor muda com a luz acesa e também com ela apagada (vale ao acender)
    await branca.click();
    assert.equal(await branca.getAttribute("aria-pressed"), "true");
    assert.equal(await amarela.getAttribute("aria-pressed"), "false");
    assert.equal((await estado()).color, "branca");
    await luz.click();
    assert.equal(await luz.getAttribute("aria-pressed"), "false");
    await amarela.click();
    assert.deepEqual(await estado(), { on: false, color: "amarela", count: e0.count });

    // trocar de planta mantém a escolha e monta as luzes da planta nova
    await luz.click();
    await page.selectOption("#t-planta", "tres-suites");
    await page.waitForFunction(() => window.MiranteTour.plan === "tres-suites");
    const e1 = await estado();
    assert.equal(e1.on, true);
    assert.ok(e1.count > e0.count);
    assert.equal(await luz.getAttribute("aria-pressed"), "true");
  } finally {
    await ctx.close();
  }
  assert.deepEqual(problemas, []);
});
