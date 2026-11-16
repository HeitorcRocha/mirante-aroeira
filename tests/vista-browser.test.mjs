// Vista da varanda do espelho de vendas, em navegador real. Mesmo padrão de
// espelho-browser.test.mjs: playwright-core, Edge/Chrome do sistema, servidor
// HTTP mínimo; sem navegador ou sem WebGL os testes se pulam. Espera por
// MiranteEspelho.busy, não por timers fixos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tower } from "../data/tower.js";
import { plans } from "../data/plans.js";
import { balconyEye } from "../tour/tower.js";

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

/* --------------------------------------------------------------- ajudas -- */

const byId = (id) => tower.units.find((u) => u.id === id);
const RAD = Math.PI / 180;
// Onde ficam os olhos, na cena: X = x da laje, Y = altura, Z = y da laje.
const olho = (id) => { const e = balconyEye(tower, byId(id), plans); return [e.x, e.z, e.y]; };
const normalDe = (id) => balconyEye(tower, byId(id), plans).normal;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const perto = (a, b, tol, msg) => assert.ok(dist3(a, b) < tol, `${msg}: ${a.map((v) => v.toFixed(3))} longe de ${b.map((v) => v.toFixed(3))}`);

/**
 * Abre uma página nova. Devolve null (e o teste deve pular) se a página caiu no
 * plano B por falta de WebGL. Devolve { page, ctx, problemas, fechar }.
 * celular: true liga o emulador de toque (pointer: coarse).
 */
async function abrir(query = "", { reduzido = true, viewport = { width: 1280, height: 800 }, celular = false } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduzido ? "reduce" : "no-preference", ...(celular ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const problemas = [];
  page.on("console", (m) => { if (m.type() === "error") problemas.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problemas.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) problemas.push(`HTTP ${r.status()}: ${r.url()}`); });
  const fechar = () => ctx.close();
  await page.goto(`${base}/espelho.html${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.classList.contains("is-ready") || !document.querySelector("#e-fallback").hidden, null, { timeout: 20000 });
  if (await page.locator("#e-fallback").isVisible()) { await fechar(); return null; }
  await ocioso(page);
  return { page, ctx, problemas, fechar };
}

const ocioso = (page) => page.waitForFunction(() => window.MiranteEspelho && window.MiranteEspelho.busy === false, null, { timeout: 20000 });
const cel = (page, id) => page.locator(`#e-grid button[data-unit="${id}"]`);
const clicaCelula = (page, id) => page.evaluate((i) => document.querySelector(`#e-grid button[data-unit="${i}"]`).click(), id);
const doisQuadros = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const estado = (page) => page.evaluate(() => {
  const m = window.MiranteEspelho;
  return { mode: m.mode, fov: m.fov, look: m.look, city: m.city, camera: m.camera, busy: m.busy, selected: m.selected, view: m.view, availability: m.availability, search: location.search };
});
const pressionadas = (page) => page.$$eval("#e-grid button[data-unit]", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.dataset.unit)));
const params = (page) => new URL(page.url()).searchParams;

/** Ângulos do olhar em relação à normal da fachada, tirados da direção REAL da câmera (não do que a página diz). */
function angulos(e, normal) {
  const [dx, dy, dz] = e.look.direction;
  let yaw = (Math.atan2(dx, -dz) - Math.atan2(normal[0], -normal[1])) / RAD;
  yaw = ((yaw + 540) % 360) - 180;
  return { yaw, pitch: Math.asin(Math.max(-1, Math.min(1, dy))) / RAD, fora: dx * normal[0] + dz * normal[1] };
}

async function comPagina(t, query, opts, fn) {
  if (!browser) return t.skip(motivoSkip);
  const a = await abrir(query, opts);
  if (!a) return t.skip("este navegador não tem WebGL (swiftshader indisponível)");
  try {
    await fn(a);
  } finally {
    await a.fechar();
  }
  assert.deepEqual(a.problemas, [], `problemas no navegador:\n${a.problemas.join("\n")}`);
}

function mesmaPose(e, ref, msg) {
  perto(e.camera.target, ref.camera.target, 0.5, `${msg}: alvo`);
  const r = (c) => Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
  assert.ok(Math.abs(r(e.camera) - r(ref.camera)) < 0.5, `${msg}: distância ao alvo ${r(e.camera)} x ${r(ref.camera)}`);
  assert.ok(Math.abs(e.camera.position[1] - ref.camera.position[1]) < 0.5, `${msg}: altura`);
  // o lado (esquerda ou direita da unidade) depende de onde a câmera estava; o lado da fachada, não
  assert.equal(Math.sign(e.camera.position[2] - 10), Math.sign(ref.camera.position[2] - 10), `${msg}: do outro lado da torre`);
}

/** Escolhe a unidade na grade e entra na vista pelo botão da ficha. */
async function entrar(page, id) {
  await cel(page, id).click();
  await ocioso(page);
  await page.click("#e-f-vista");
  await ocioso(page);
}

async function caixa(page, sel) {
  const b = await page.locator(sel).boundingBox();
  assert.ok(b, `${sel} sem caixa na tela`);
  return b;
}
const cruzam = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const dentro = (a, b, tol = 0.5) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.width <= b.x + b.width + tol && a.y + a.height <= b.y + b.height + tol;

/** Brilho médio e contraste (desvio) do que aparece na cena, de 0 a 255, a partir de uma captura de tela. */
async function brilho(page) {
  const b64 = (await page.locator("#e-canvas").screenshot()).toString("base64");
  return page.evaluate(async (dados) => {
    const img = new Image();
    img.src = `data:image/png;base64,${dados}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let s = 0, s2 = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += y; s2 += y * y; }
    const m = s / n;
    return { mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
  }, b64);
}

/* ---------------------------------------------------------------- testes -- */

test("vista: antes de entrar o modo é torre e a cidade nem foi montada", { timeout: 90000 }, async (t) => {
  await comPagina(t, "?unidade=1302", {}, async ({ page }) => {
    const e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.city, null, "a cidade só deve ser montada na primeira entrada na vista");
    assert.equal(e.look.yaw, null);
    assert.equal(e.look.pitch, null);
    assert.equal(await page.locator("#e-vista").isHidden(), true);
    assert.equal(await page.locator("#e-views").isVisible(), true);
    assert.equal(await page.getAttribute("#e-f-vista", "aria-pressed"), "false");
    assert.equal(await page.evaluate(() => document.body.classList.contains("is-vista")), false);
    assert.equal(params(page).has("vista"), false);
    // sem unidade escolhida o botão da ficha nem aparece
    await page.keyboard.press("Escape");
  });
  await comPagina(t, "", {}, async ({ page }) => {
    assert.equal(await page.locator("#e-f-vista").isHidden(), true, "sem unidade escolhida não há vista para abrir");
    assert.equal((await estado(page)).city, null);
  });
});

test("vista: entrar pelo botão põe a câmera na varanda, olhando para fora, com a cidade e a barra", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await cel(page, 1302).click();
    await ocioso(page);
    const antes = await estado(page);
    assert.equal(await page.locator("#e-f-vista").isVisible(), true);
    await page.click("#e-f-vista");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "vista");
    assert.equal(e.selected, 1302);
    perto(e.camera.position, olho(1302), 1e-3, "a câmera devia estar nos olhos da varanda do 1302");
    // olha para fora (os fundos do 1302 apontam para +y da laje) e levemente para baixo
    const a = angulos(e, normalDe(1302));
    assert.ok(a.fora > 0.9, `o olhar devia sair da fachada: cos = ${a.fora}`);
    assert.ok(Math.abs(a.yaw) < 1, `yaw inicial ${a.yaw}`);
    assert.ok(a.pitch < 0 && a.pitch > -15, `inclinação inicial ${a.pitch}°`);
    assert.equal(e.look.yaw, 0);
    assert.ok(Math.abs(e.fov - 62) < 1e-9, `FOV inicial ${e.fov}`);
    assert.ok(e.fov !== antes.fov);
    // a cidade apareceu
    assert.ok(e.city, "a cidade devia existir depois da primeira vista");
    assert.ok(e.city.visible);
    assert.ok(e.city.boxes > 1000 && e.city.boxes <= 5000, `caixas: ${e.city.boxes}`);
    assert.ok(e.city.lights > 1000 && e.city.lights <= 20000 + 400, `luzes: ${e.city.lights}`);
    assert.ok(e.city.hills > 10 && e.city.trees > 0);
    // a interface
    assert.equal(await page.locator("#e-vista").isVisible(), true);
    assert.equal(await page.locator("#e-views").isHidden(), true, "os botões de vista da torre saem de cena");
    assert.equal(await page.getAttribute("#e-f-vista", "aria-pressed"), "true");
    assert.equal(await page.evaluate(() => document.body.classList.contains("is-vista")), true);
    assert.match(await page.locator("#e-vista-rotulo").innerText(), /1302/);
    assert.match(await page.locator("#e-vista-rotulo").innerText(), /13º/);
    assert.match(await page.locator("#e-vista-rotulo").innerText(), /sul/);
    assert.match(await page.locator("#e-hint").innerText(), /olhar em volta/);
    assert.match(await page.getAttribute("#e-canvas", "aria-label"), /Vista da varanda do apartamento 1302/);
    // endereço
    assert.equal(params(page).get("vista"), "1");
    assert.equal(params(page).get("unidade"), "1302");
    // a seleção segue de pé
    assert.deepEqual(await pressionadas(page), [1302]);
    assert.equal(await page.locator("#e-f-num").innerText(), "Apartamento 1302");
  });
});

test("vista: ?unidade=<id>&vista=1 abre direto na varanda; recarregar a página volta para ela", { timeout: 120000 }, async (t) => {
  for (const id of [1302, 201]) {
    await comPagina(t, `?unidade=${id}&vista=1`, {}, async ({ page }) => {
      const e = await estado(page);
      assert.equal(e.mode, "vista", `unidade ${id}`);
      assert.equal(e.selected, id);
      assert.equal(e.busy, false);
      perto(e.camera.position, olho(id), 1e-3, `câmera de ${id}`);
      assert.ok(angulos(e, normalDe(id)).fora > 0.9);
      assert.equal(await page.locator("#e-vista").isVisible(), true);
      assert.deepEqual(await pressionadas(page), [id]);
      assert.ok(e.city && e.city.visible);
    });
  }
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 702);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.body.classList.contains("is-ready"), null, { timeout: 20000 });
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "vista");
    assert.equal(e.selected, 702);
    perto(e.camera.position, olho(702), 1e-3, "câmera depois de recarregar");
  });
});

test("vista: ?vista=1 sem unidade válida é ignorado; só o valor 1 vale", { timeout: 240000 }, async (t) => {
  const ignorados = ["?vista=1", "?unidade=99999&vista=1", "?unidade=abc&vista=1", "?unidade=&vista=1", "?unidade=0&vista=1"];
  for (const q of ignorados) {
    await comPagina(t, q, {}, async ({ page }) => {
      const e = await estado(page);
      assert.equal(e.mode, "torre", q);
      assert.equal(e.selected, null, q);
      assert.equal(e.city, null, q);
      assert.equal(await page.locator("#e-vista").isHidden(), true, q);
      assert.equal(await page.locator("#e-views").isVisible(), true, q);
    });
  }
  for (const v of ["true", "2", "", "0", "yes", "01", "1.0", " 1", "%31x", "on"]) {
    const q = `?unidade=1302&vista=${v}`;
    await comPagina(t, q, {}, async ({ page }) => {
      const e = await estado(page);
      assert.equal(e.mode, "torre", `${q} não devia abrir a vista`);
      assert.equal(e.selected, 1302, `${q}: a unidade vale mesmo assim`);
      assert.equal(e.city, null);
      assert.equal(await page.locator("#e-vista").isHidden(), true, q);
    });
  }
});

test("vista: TODAS as 62 unidades levam a câmera para a própria varanda, olhando para fora", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 201);
    const ids = tower.units.map((u) => u.id).sort((a, b) => a - b);
    for (const id of ids) {
      if (id === 201) continue;
      await clicaCelula(page, id);
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.mode, "vista", `${id}`);
      assert.equal(e.selected, id);
      perto(e.camera.position, olho(id), 1e-3, `varanda de ${id}`);
      const a = angulos(e, normalDe(id));
      assert.ok(a.fora > 0.9, `${id}: olhando para dentro da torre (cos ${a.fora})`);
    }
  });
});

test("vista: o olhar vai para a direita com a seta direita e para a esquerda com a esquerda, nos dois lados da torre", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    // frente: olha para -z; a direita de quem olha é +x
    await page.keyboard.press("ArrowRight");
    let e = await estado(page);
    assert.ok(e.look.direction[0] > 0.05, `1301 + ArrowRight: x ${e.look.direction[0]}`);
    assert.ok(e.look.yaw > 0);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    e = await estado(page);
    assert.ok(e.look.direction[0] < -0.05, `1301 + ArrowLeft: x ${e.look.direction[0]}`);
  });
  await comPagina(t, "?unidade=1302&vista=1", {}, async ({ page }) => {
    // fundos: olha para +z; a direita de quem olha é -x
    await page.keyboard.press("ArrowRight");
    const e = await estado(page);
    assert.ok(e.look.direction[0] < -0.05, `1302 + ArrowRight: x ${e.look.direction[0]}`);
    assert.ok(e.look.yaw > 0);
  });
});

test("vista: setas respeitam yaw ±85° e pitch -55° a +30°; yaw e pitch informados batem com a câmera de verdade", { timeout: 180000 }, async (t) => {
  await comPagina(t, "?unidade=1302&vista=1", {}, async ({ page }) => {
    const n = normalDe(1302);
    const serie = async (tecla, vezes, campo) => {
      const v = [];
      for (let i = 0; i < vezes; i++) { await page.keyboard.press(tecla); v.push((await estado(page)).look[campo]); }
      return v;
    };
    const direita = await serie("ArrowRight", 30, "yaw");
    assert.ok(direita.every((y) => y <= 85 + 1e-9), `passou de 85°: ${Math.max(...direita)}`);
    assert.ok(direita.every((y, i) => i === 0 || y >= direita[i - 1] - 1e-9), "yaw devia só crescer");
    assert.equal(direita.at(-1), 85, "devia parar em 85°");
    let e = await estado(page);
    let a = angulos(e, n);
    assert.ok(Math.abs(a.yaw - 85) < 0.5, `câmera a ${a.yaw}°, informado 85°`);

    const esquerda = await serie("ArrowLeft", 60, "yaw");
    assert.ok(esquerda.every((y) => y >= -85 - 1e-9), `passou de -85°: ${Math.min(...esquerda)}`);
    assert.equal(esquerda.at(-1), -85);
    e = await estado(page);
    a = angulos(e, n);
    assert.ok(Math.abs(a.yaw + 85) < 0.5, `câmera a ${a.yaw}°, informado -85°`);

    const cima = await serie("ArrowUp", 30, "pitch");
    assert.ok(cima.every((p) => p <= 30 + 1e-9), `passou de +30°: ${Math.max(...cima)}`);
    assert.equal(cima.at(-1), 30);
    e = await estado(page);
    assert.ok(Math.abs(angulos(e, n).pitch - 30) < 0.5);

    const baixo = await serie("ArrowDown", 40, "pitch");
    assert.ok(baixo.every((p) => p >= -55 - 1e-9), `passou de -55°: ${Math.min(...baixo)}`);
    assert.equal(baixo.at(-1), -55);
    e = await estado(page);
    assert.ok(Math.abs(angulos(e, n).pitch + 55) < 0.5);
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(1302), 1e-3, "olhar em volta não mexe os olhos");
  });
});

test("vista: + e - mudam o campo de visão entre 34° e 74°, sem passar", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    const antes = (await estado(page)).fov;
    await page.keyboard.press("+");
    const um = (await estado(page)).fov;
    assert.ok(um < antes, `'+' devia aproximar (FOV menor): ${antes} -> ${um}`);
    const v = [um];
    for (let i = 0; i < 40; i++) { await page.keyboard.press("+"); v.push((await estado(page)).fov); }
    assert.ok(v.every((f) => f >= 34 - 1e-9), `passou de 34°: ${Math.min(...v)}`);
    assert.ok(v.every((f, i) => i === 0 || f <= v[i - 1] + 1e-9), "FOV devia só diminuir");
    assert.ok(Math.abs(v.at(-1) - 34) < 1e-9, `devia parar em 34°, parou em ${v.at(-1)}`);
    await page.keyboard.press("-");
    assert.ok((await estado(page)).fov > 34, "'-' devia afastar");
    const w = [];
    for (let i = 0; i < 60; i++) { await page.keyboard.press("-"); w.push((await estado(page)).fov); }
    assert.ok(w.every((f) => f <= 74 + 1e-9), `passou de 74°: ${Math.max(...w)}`);
    assert.ok(Math.abs(w.at(-1) - 74) < 1e-9, `devia parar em 74°, parou em ${w.at(-1)}`);
  });
});

test("vista: arrastar olha em volta (a cena acompanha o dedo), respeita os limites e não mexe nos olhos nem na seleção", { timeout: 180000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    const cv = await caixa(page, "#e-canvas");
    const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
    const arrasta = async (dx, dy) => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
      await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
      await page.mouse.up();
    };
    const antes = await estado(page);
    await arrasta(120, 0);
    let e = await estado(page);
    assert.ok(e.look.yaw < -1, `arrastar para a direita devia virar o olhar para a esquerda (yaw ${e.look.yaw})`);
    assert.ok(e.look.direction[0] < -0.02, "1301 olha para -z: a esquerda é -x");
    await arrasta(-300, 0);
    e = await estado(page);
    assert.ok(e.look.yaw > 1, `arrastar para a esquerda devia virar para a direita (yaw ${e.look.yaw})`);
    // arrastar para baixo puxa o olhar para cima (a cena acompanha o dedo)
    const p0 = e.look.pitch;
    await arrasta(0, 60);
    e = await estado(page);
    assert.ok(e.look.pitch > p0 + 1, `arrastar para baixo devia levantar o olhar: ${p0} -> ${e.look.pitch}`);
    // longe demais: trava nos limites
    for (let i = 0; i < 6; i++) await arrasta(-Math.min(cv.width / 2 - 5, 500), 0);
    e = await estado(page);
    assert.equal(e.look.yaw, 85, `yaw preso em 85° (está em ${e.look.yaw})`);
    for (let i = 0; i < 6; i++) await arrasta(Math.min(cv.width / 2 - 5, 500), 0);
    assert.equal((await estado(page)).look.yaw, -85);
    for (let i = 0; i < 4; i++) await arrasta(0, Math.min(cv.height / 2 - 5, 380));
    assert.equal((await estado(page)).look.pitch, 30);
    for (let i = 0; i < 6; i++) await arrasta(0, -Math.min(cv.height / 2 - 5, 380));
    e = await estado(page);
    assert.equal(e.look.pitch, -55);
    // nada mais mudou
    assert.equal(e.mode, "vista");
    assert.equal(e.selected, 1301);
    perto(e.camera.position, olho(1301), 1e-3, "arrastar na vista não pode orbitar a câmera");
    assert.equal(e.fov, antes.fov, "arrastar não muda o FOV");
    assert.deepEqual(await pressionadas(page), [1301]);
    assert.ok(Math.abs(angulos(e, normalDe(1301)).pitch + 55) < 0.5);
  });
});

test("vista: a roda aproxima (para cima) e afasta (para baixo) dentro de 34° a 74° e não rola a página", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    const cv = await caixa(page, "#e-canvas");
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    const f0 = (await estado(page)).fov;
    await page.mouse.wheel(0, -120);
    const f1 = (await estado(page)).fov;
    assert.ok(f1 < f0, `roda para cima devia aproximar: ${f0} -> ${f1}`);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -240);
    assert.ok(Math.abs((await estado(page)).fov - 34) < 1e-9, `FOV mínimo: ${(await estado(page)).fov}`);
    await page.mouse.wheel(0, 120);
    assert.ok((await estado(page)).fov > 34);
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 240);
    assert.ok(Math.abs((await estado(page)).fov - 74) < 1e-9, `FOV máximo: ${(await estado(page)).fov}`);
    // um gesto absurdo de roda não pula o limite
    await page.mouse.wheel(0, -100000);
    assert.ok((await estado(page)).fov >= 34 - 1e-9);
    // o evento é cancelado: a página não rola
    const cancelado = await page.evaluate(() => {
      const ev = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
      document.getElementById("e-canvas").dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(cancelado, true, "a roda sobre a cena na vista devia ter preventDefault");
    assert.equal(await page.evaluate(() => window.scrollY), 0);
  });
});

test("vista: o brilho e o contraste da cena mudam com o olhar e com o sol (a cena é desenhada de verdade)", { timeout: 180000 }, async (t) => {
  await comPagina(t, "?unidade=1302&vista=1", {}, async ({ page }) => {
    await page.locator("#e-hour").fill("12");
    await ocioso(page);
    await doisQuadros(page);
    const dia = await brilho(page);
    assert.ok(dia.sd > 8, `cena de dia quase uniforme (desvio ${dia.sd.toFixed(1)}): nada desenhado?`);
    await page.locator("#e-hour").fill("5");
    await ocioso(page);
    await doisQuadros(page);
    const noite = await brilho(page);
    assert.ok(dia.mean > noite.mean + 15, `meio-dia (${dia.mean.toFixed(0)}) devia ser bem mais claro que 5h (${noite.mean.toFixed(0)})`);
    assert.equal((await estado(page)).mode, "vista", "mudar o sol não sai da vista");
    perto((await estado(page)).camera.position, olho(1302), 1e-3, "o sol não move a câmera");
    // olhar para outro lado muda a imagem
    await page.locator("#e-hour").fill("12");
    await doisQuadros(page);
    const a = (await page.locator("#e-canvas").screenshot()).toString("base64");
    await page.locator("#e-canvas").focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await doisQuadros(page);
    const b = (await page.locator("#e-canvas").screenshot()).toString("base64");
    assert.notEqual(a, b, "olhar para o lado não mudou a imagem");
  });
});

test("vista: andar acima e abaixo levam à unidade empilhada, com a câmera subindo um piso a piso", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 702);
    assert.equal(await page.locator("#e-vista-acima").isEnabled(), true);
    assert.equal(await page.locator("#e-vista-abaixo").isEnabled(), true);
    const z0 = (await estado(page)).camera.position[1];
    await page.click("#e-vista-acima");
    await ocioso(page);
    let e = await estado(page);
    assert.equal(e.selected, 802);
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(802), 1e-3, "802");
    assert.ok(Math.abs(e.camera.position[1] - z0 - 3.1) < 1e-6, `subiu ${e.camera.position[1] - z0} m, esperado 3,1`);
    assert.deepEqual(await pressionadas(page), [802]);
    assert.equal(await page.locator("#e-f-num").innerText(), "Apartamento 802");
    assert.equal(params(page).get("unidade"), "802");
    assert.equal(params(page).get("vista"), "1");
    assert.match(await page.locator("#e-vista-rotulo").innerText(), /802/);
    assert.match(await page.locator("#e-vista-rotulo").innerText(), /8º/);
    assert.ok(angulos(e, normalDe(802)).fora > 0.9);

    await page.click("#e-vista-abaixo");
    await ocioso(page);
    await page.click("#e-vista-abaixo");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.selected, 603, "802 (centro 13,5) -> 702 -> studio 603 (centro 14)");
    perto(e.camera.position, olho(603), 1e-3, "603");
    // troca de tipologia: de 603 (studio) para cima cai no dois-quartos 702, o de centro mais próximo
    await page.click("#e-vista-acima");
    await ocioso(page);
    assert.equal((await estado(page)).selected, 702);
    perto((await estado(page)).camera.position, olho(702), 1e-3, "702");
    assert.equal(await page.locator("#e-f-tipo").innerText(), "Dois quartos");
    // de 602 (studio, centro 9) para cima há empate entre 701 e 702: vence o menor
    await cel(page, 602).click();
    await ocioso(page);
    await page.click("#e-vista-acima");
    await ocioso(page);
    assert.equal((await estado(page)).selected, 701);
  });
});

test("vista: PageUp e PageDown trocam de andar; nos extremos nada acontece e o botão fica desabilitado", { timeout: 180000 }, async (t) => {
  await comPagina(t, "?unidade=1502&vista=1", {}, async ({ page }) => {
    await page.keyboard.press("PageUp");
    await ocioso(page);
    let e = await estado(page);
    assert.equal(e.selected, 1602);
    perto(e.camera.position, olho(1602), 1e-3, "1602");
    // topo: acima desabilitado, abaixo habilitado, rótulo acessível explica
    assert.equal(await page.locator("#e-vista-acima").isDisabled(), true);
    assert.equal(await page.locator("#e-vista-abaixo").isEnabled(), true);
    assert.match(await page.getAttribute("#e-vista-acima", "aria-label"), /não há apartamento acima/);
    assert.match(await page.getAttribute("#e-vista-abaixo", "aria-label"), /1502/);
    assert.match(await page.getAttribute("#e-vista-abaixo", "aria-label"), /15º/);
    await page.keyboard.press("PageUp");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.selected, 1602, "PageUp no topo não pode mudar nada");
    assert.equal(e.mode, "vista");
    await page.keyboard.press("PageDown");
    await ocioso(page);
    assert.equal((await estado(page)).selected, 1502);
    assert.equal(await page.locator("#e-vista-acima").isEnabled(), true);
  });
  // base: andar 2
  await comPagina(t, "?unidade=302&vista=1", {}, async ({ page }) => {
    assert.equal(await page.locator("#e-vista-abaixo").isEnabled(), true);
    await page.keyboard.press("PageDown");
    await ocioso(page);
    assert.equal((await estado(page)).selected, 202);
    assert.equal(await page.locator("#e-vista-abaixo").isDisabled(), true);
    assert.equal(await page.locator("#e-vista-acima").isEnabled(), true);
    assert.match(await page.getAttribute("#e-vista-abaixo", "aria-label"), /não há apartamento abaixo/);
    await page.keyboard.press("PageDown");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.selected, 202, "PageDown na base não pode mudar nada");
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(202), 1e-3, "202");
    // com o botão desabilitado, clicar à força não faz nada
    await page.locator("#e-vista-abaixo").click({ force: true, trial: false }).catch(() => {});
    await ocioso(page);
    assert.equal((await estado(page)).selected, 202);
  });
});

test("vista: subir com o mouse até o topo passa o foco do botão que ficou desabilitado para o outro", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1502&vista=1", {}, async ({ page }) => {
    await page.click("#e-vista-acima");
    await ocioso(page);
    assert.equal(await page.locator("#e-vista-acima").isDisabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "e-vista-abaixo", "o foco não pode se perder no botão desabilitado");
  });
});

test("vista: escolher outra unidade na grade, dentro da vista, leva a câmera para a varanda dela", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 1302);
    for (const id of [1301, 205, 702, 1003]) {
      await cel(page, id).click();
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.mode, "vista", `depois de ${id}`);
      assert.equal(e.selected, id);
      perto(e.camera.position, olho(id), 1e-3, `varanda de ${id}`);
      assert.ok(angulos(e, normalDe(id)).fora > 0.9);
      assert.deepEqual(await pressionadas(page), [id]);
      assert.equal(params(page).get("unidade"), String(id));
      assert.equal(params(page).get("vista"), "1");
      assert.equal(await page.locator("#e-f-num").innerText(), `Apartamento ${id}`);
      assert.match(await page.locator("#e-vista-rotulo").innerText(), new RegExp(String(id)));
    }
  });
});

test("vista: Esc sai da vista mantendo a unidade; o modo torre volta ao normal", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await cel(page, 1302).click();
    await ocioso(page);
    const torre = await estado(page);
    await page.click("#e-f-vista");
    await ocioso(page);
    assert.equal((await estado(page)).mode, "vista");
    await page.keyboard.press("Escape");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.selected, 1302, "Esc não solta a unidade");
    assert.deepEqual(await pressionadas(page), [1302]);
    assert.equal(params(page).get("unidade"), "1302");
    assert.equal(params(page).has("vista"), false, "o endereço perde o ?vista=1");
    assert.equal(await page.locator("#e-vista").isHidden(), true);
    assert.equal(await page.locator("#e-views").isVisible(), true);
    assert.equal(await page.getAttribute("#e-f-vista", "aria-pressed"), "false");
    assert.equal(await page.evaluate(() => document.body.classList.contains("is-vista")), false);
    assert.ok(Math.abs(e.fov - torre.fov) < 1e-9, `lente da torre não voltou: ${torre.fov} -> ${e.fov}`);
    assert.equal(e.city && e.city.visible, false, "a cidade devia ficar escondida no modo torre");
    assert.equal(e.look.yaw, null);
    // a câmera volta a enquadrar a unidade, como se ela tivesse sido escolhida direto
    mesmaPose(e, torre, "depois da vista");
    assert.match(await page.locator("#e-hint").innerText(), /girar a torre/);
    assert.match(await page.getAttribute("#e-canvas", "aria-label"), /^Torre do/);
    // segundo Esc: agora sim solta a seleção (comportamento de sempre do modo torre)
    await page.locator("#e-canvas").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    assert.equal((await estado(page)).selected, null);
    assert.equal((await estado(page)).mode, "torre");
  });
});

test("vista: 'Voltar à torre' e o botão da ficha também saem; o foco volta para quem abriu", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 702);
    await page.click("#e-vista-voltar");
    await ocioso(page);
    let e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.selected, 702);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "e-f-vista", "o foco devia voltar ao botão da ficha, não se perder no body");
    // o botão da ficha abre e fecha (alterna)
    await page.click("#e-f-vista");
    await ocioso(page);
    assert.equal((await estado(page)).mode, "vista");
    assert.equal(await page.getAttribute("#e-f-vista", "aria-pressed"), "true");
    await page.click("#e-f-vista");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(await page.getAttribute("#e-f-vista", "aria-pressed"), "false");
    assert.equal(e.selected, 702);
  });
  // vista aberta pelo endereço (sem foco na cena): Esc no body também sai
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    await page.keyboard.press("Escape");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.selected, 1301);
  });
});

test("vista: Esc com o foco na grade também sai da vista e mantém a unidade", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    await cel(page, 1301).focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.selected, 1301, "Esc na grade, dentro da vista, não solta a unidade");
  });
});

test("vista: clicar de novo na célula da própria unidade não desmarca nem derruba a vista", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 1302);
    const antes = await estado(page);
    await cel(page, 1302).click();
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.selected, 1302, "a unidade continua escolhida");
    assert.equal(e.mode, "vista", "a vista continua aberta");
    assert.deepEqual(await pressionadas(page), [1302]);
    assert.equal(await page.locator("#e-vista").isVisible(), true);
    assert.equal(params(page).get("unidade"), "1302");
    assert.equal(params(page).get("vista"), "1");
    perto(e.camera.position, antes.camera.position, 1e-6, "a câmera não sai da varanda");
    // no modo torre o mesmo clique continua desmarcando
    await page.locator("#e-canvas").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    await cel(page, 1302).click();
    await ocioso(page);
    const f = await estado(page);
    assert.equal(f.selected, null);
    assert.equal(f.mode, "torre");
    assert.equal(params(page).has("unidade"), false);
    assert.equal(params(page).has("vista"), false);
    assert.equal(f.city && f.city.visible, false);
  });
});

/* ------------------------------------------------ regressões da revisão -- */

test("vista: com movimento reduzido, entrar com a câmera do outro lado da torre (depois de 'Aérea') chega à varanda, sem erro", { timeout: 120000 }, async (t) => {
  // fly() lia "t" dentro do done do tween, que com movimento reduzido roda antes de "t" existir
  for (const [id, vista] of [[1302, "aerea"], [1301, "fundos"], [1302, "fachada"]]) {
    await comPagina(t, `?unidade=${id}`, { reduzido: true }, async ({ page }) => {
      await page.click(`#e-views button[data-view="${vista}"]`);
      await ocioso(page);
      await page.click("#e-f-vista");
      await page.waitForFunction(() => window.MiranteEspelho.mode === "vista", null, { timeout: 10000 });
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.mode, "vista");
      perto(e.camera.position, olho(id), 1e-6, `${id} depois de "${vista}": câmera fora do olho da varanda`);
      assert.ok(angulos(e, normalDe(id)).fora > 0.9, "olhando para fora");
      assert.equal(e.fov, 62);
      assert.ok(e.city && e.city.visible);
      // e os controles da vista respondem
      await page.keyboard.press("ArrowRight");
      assert.ok((await estado(page)).look.yaw > 0);
    });
  }
});

test("vista: Esc sai da vista também com o foco no slider de hora e no botão da ficha; em <select> não", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    await page.locator("#e-hour").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    let e = await estado(page);
    assert.equal(e.mode, "torre", "Esc no slider de hora devia sair da vista");
    assert.equal(e.selected, 1301, "e manter a unidade");
    await page.click("#e-f-vista");
    await ocioso(page);
    await page.locator("#e-f-vista").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    assert.equal((await estado(page)).mode, "torre", "Esc no botão da ficha");
    await page.click("#e-f-vista");
    await ocioso(page);
    await page.locator("#e-month").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.mode, "vista", "Esc num <select> é do select");
    // fora da vista o Esc no slider continua sem soltar a unidade
    await page.locator("#e-canvas").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    await page.locator("#e-hour").focus();
    await page.keyboard.press("Escape");
    assert.equal((await estado(page)).selected, 1301);
  });
});

/** Dispara um PointerEvent sintético de toque no canvas, em coordenadas relativas ao centro dele. */
const toque = (page, tipo, id, dx = 0, dy = 0) => page.evaluate(([type, pointerId, ox, oy]) => {
  const c = document.getElementById("e-canvas"), r = c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent(type, {
    pointerId, pointerType: "touch", isPrimary: pointerId === 11, button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: r.left + r.width / 2 + ox, clientY: r.top + r.height / 2 + oy, bubbles: true, cancelable: true,
  }));
}, [tipo, id, dx, dy]);

test("vista: pinça muda o campo de visão dentro de 34° a 74° e não gira o olhar", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    const e0 = await estado(page);
    await toque(page, "pointerdown", 11, -30, 0);
    await toque(page, "pointerdown", 12, 30, 0);
    await toque(page, "pointermove", 12, 60, 0);          // abre os dedos: aproxima
    let e = await estado(page);
    assert.ok(e.fov < e0.fov, `abrir os dedos devia aproximar: ${e0.fov} -> ${e.fov}`);
    assert.equal(e.look.yaw, 0, "pinça não gira o olhar");
    assert.equal(e.look.pitch, e0.look.pitch);
    for (const d of [200, 600, 2000, 9000]) await toque(page, "pointermove", 12, d, 0);
    assert.ok(Math.abs((await estado(page)).fov - 34) < 1e-9, "limite de perto");
    for (const d of [2000, 300, 40, -20, -28, -29.5]) await toque(page, "pointermove", 12, d, 0);
    assert.ok(Math.abs((await estado(page)).fov - 74) < 1e-9, `limite aberto: ${(await estado(page)).fov}`);
    await toque(page, "pointerup", 12, -29.5, 0);
    await toque(page, "pointerup", 11, -30, 0);
    e = await estado(page);
    assert.equal(e.look.yaw, 0);
    assert.equal(e.selected, 1301);
    assert.equal(e.mode, "vista");
  });
});

test("vista: toque cancelado ou que perde a captura sai da conta; um dedo volta a arrastar em vez de virar pinça", { timeout: 120000 }, async (t) => {
  for (const fim of ["pointercancel", "lostpointercapture"]) {
    await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page, problemas }) => {
      // um dedo desce e some sem pointerup
      await toque(page, "pointerdown", 11, 0, 0);
      await toque(page, fim, 11, 0, 0);
      // outro dedo arrasta: tem de ser arrasto, não pinça com o dedo morto
      const e0 = await estado(page);
      await toque(page, "pointerdown", 12, 100, 0);
      await toque(page, "pointermove", 12, 40, 0);
      await toque(page, "pointermove", 12, -20, 0);
      await toque(page, "pointerup", 12, -20, 0);
      const e = await estado(page);
      assert.equal(e.fov, e0.fov, `${fim}: um dedo só não pode mudar o campo de visão`);
      assert.ok(e.look.yaw > 3, `${fim}: arrastar para a esquerda devia virar o olhar para a direita (yaw ${e.look.yaw})`);
      // O OrbitControls do vendor solta a captura de qualquer pointercancel; com o
      // pointerId inventado deste teste (não há ponteiro de verdade) o navegador
      // reclama. É efeito do evento sintético, não da página: sai da conta.
      for (let i = problemas.length - 1; i >= 0; i--) if (/releasePointerCapture/.test(problemas[i])) problemas.splice(i, 1);
    });
  }
});

test("vista: um terceiro dedo não bagunça a pinça; ao sair, ela recomeça dos dois que ficaram, sem salto", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    await toque(page, "pointerdown", 11, -40, 0);
    await toque(page, "pointerdown", 12, 40, 0);
    await toque(page, "pointermove", 12, 60, 0);
    const comDois = (await estado(page)).fov;
    assert.ok(comDois < 62);
    await toque(page, "pointerdown", 13, 0, 150);
    await toque(page, "pointermove", 13, 0, 250);          // com três dedos nada muda
    await toque(page, "pointermove", 12, 200, 0);
    let e = await estado(page);
    assert.equal(e.fov, comDois, "com três dedos o campo de visão não muda");
    assert.equal(e.look.yaw, 0, "nem o olhar");
    await toque(page, "pointerup", 13, 0, 250);
    // os dois que ficaram estão a 240 px um do outro: sem mover, nada muda; ao mover, muda pouco, sem salto
    e = await estado(page);
    assert.equal(e.fov, comDois);
    await toque(page, "pointermove", 12, 212, 0);          // 240 -> 252 px: 5% mais perto
    e = await estado(page);
    assert.ok(Math.abs(e.fov - comDois * (240 / 252)) < 1e-6, `pinça recalculada: ${comDois} -> ${e.fov}`);
    await toque(page, "pointerup", 12, 212, 0);
    // sobra um dedo: volta a ser arrasto
    await toque(page, "pointermove", 11, -100, 0);
    e = await estado(page);
    assert.ok(e.look.yaw > 0, "com um dedo de novo, arrasta");
    await toque(page, "pointerup", 11, -100, 0);
  });
});

test("vista: o campo de visão volta a 62° ao entrar numa vista nova; de varanda em varanda na mesma fachada ele fica", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await entrar(page, 1302);
    await page.locator("#e-canvas").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("+");
    const perto_ = (await estado(page)).fov;
    assert.ok(perto_ < 62);
    await page.click("#e-vista-abaixo");
    await ocioso(page);
    assert.equal((await estado(page)).fov, perto_, "trocar de andar na mesma fachada mantém a lente");
    await page.locator("#e-canvas").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    assert.equal((await estado(page)).fov, 35);
    await page.click("#e-f-vista");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.fov, 62, "vista nova começa com a lente inicial");
    assert.equal(e.look.yaw, 0);
  });
});

test("vista: o botão da ficha diz o que faz (ver ou sair) e a entrada pelo botão não é anunciada duas vezes", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1302", {}, async ({ page }) => {
    assert.equal((await page.locator("#e-f-vista").innerText()).trim(), "Ver a vista da varanda");
    await page.click("#e-f-vista");
    await ocioso(page);
    assert.equal((await page.locator("#e-f-vista").innerText()).trim(), "Sair da vista da varanda");
    // o foco foi para a cena, cujo rótulo já descreve a vista: a região viva recebe o texto calada
    assert.equal(await page.evaluate(() => document.activeElement.id), "e-canvas");
    assert.equal(await page.getAttribute("#e-vista-live", "aria-live"), "off");
    assert.match(await page.locator("#e-vista-live").textContent(), /apartamento 1302/);
    // trocar de andar não move o foco para a cena: aí a região viva fala
    await page.click("#e-vista-abaixo");
    await ocioso(page);
    assert.equal(await page.getAttribute("#e-vista-live", "aria-live"), null);
    assert.match(await page.locator("#e-vista-live").textContent(), /apartamento 1203/);
    await page.keyboard.press("Escape");
    await ocioso(page);
    assert.equal(await page.getAttribute("#e-vista-live", "aria-live"), null);
    assert.equal((await page.locator("#e-f-vista").innerText()).trim(), "Ver a vista da varanda");
  });
});

test("vista: passar o mouse ou o foco no botão da ficha já monta a cidade, fora do voo e ainda invisível", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1302", { reduzido: false }, async ({ page }) => {
    assert.equal((await estado(page)).city, null);
    await page.locator("#e-f-vista").hover();
    await page.waitForFunction(() => window.MiranteEspelho.city !== null, null, { timeout: 10000 });
    const e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.city.visible, false, "aquecida, mas escondida no modo torre");
    assert.equal(e.fov, 35);
    assert.equal(e.busy, false);
    await page.click("#e-f-vista");
    await ocioso(page);
    const f = await estado(page);
    assert.equal(f.mode, "vista");
    perto(f.camera.position, olho(1302), 1e-6, "câmera no olho");
  });
  await comPagina(t, "?unidade=1302", {}, async ({ page }) => {
    await page.locator("#e-f-vista").focus();
    await page.waitForFunction(() => window.MiranteEspelho.city !== null, null, { timeout: 10000 });
    assert.equal((await estado(page)).city.visible, false);
  });
});

test("vista: clicar na cena não troca a seleção nem sai da vista", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1302&vista=1", {}, async ({ page }) => {
    const cv = await caixa(page, "#e-canvas");
    const pontos = [[0.5, 0.5], [0.5, 0.15], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5], [0.3, 0.7], [0.7, 0.3]];
    for (const [fx, fy] of pontos) {
      const x = cv.x + cv.width * fx, y = cv.y + cv.height * fy;
      const alvo = await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return el && el.id; }, [x, y]);
      if (alvo !== "e-canvas") continue;                      // ponto coberto pela barra: não é clique na cena
      await page.mouse.click(x, y);
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.selected, 1302, `clique em (${fx}, ${fy}) trocou a seleção`);
      assert.equal(e.mode, "vista");
      assert.deepEqual(await pressionadas(page), [1302]);
      assert.equal(params(page).get("unidade"), "1302");
      perto(e.camera.position, olho(1302), 1e-3, "clique moveu a câmera");
    }
    // clique duplo e clique com o botão do meio
    await page.mouse.dblclick(cv.x + cv.width * 0.5, cv.y + cv.height * 0.6);
    await ocioso(page);
    assert.equal((await estado(page)).selected, 1302);
  });
  // no modo torre o mesmo clique escolhe unidade (controle: o teste acima não passa por a cena estar morta)
  await comPagina(t, "", {}, async ({ page }) => {
    const p = await page.evaluate(() => window.MiranteEspelho.screenPoint(802));
    assert.ok(p.visible);
    await page.mouse.click(p.x, p.y);
    await ocioso(page);
    assert.equal((await estado(page)).selected, 802);
  });
});

test("vista: o teclado só olha em volta com o foco na cena ou na barra; na grade as setas são da grade", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1301&vista=1", {}, async ({ page }) => {
    await cel(page, 1301).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal((await estado(page)).look.yaw, 0, "seta na grade não pode virar o olhar");
    await page.locator("#e-vista-voltar").focus();
    await page.keyboard.press("ArrowRight");
    assert.ok((await estado(page)).look.yaw > 0, "com o foco na barra da vista as setas olham");
    await page.locator("#e-canvas").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    assert.ok((await estado(page)).look.yaw < 0);
  });
});

test("vista: movimento reduzido entra e sai de uma vez; sem redução há voo que termina em busy = false", { timeout: 240000 }, async (t) => {
  await comPagina(t, "", { reduzido: true }, async ({ page }) => {
    await cel(page, 1202).click();
    await ocioso(page);
    await page.click("#e-f-vista");
    // sem esperar nada: corte seco
    let e = await estado(page);
    assert.equal(e.busy, false, "com prefers-reduced-motion não pode haver voo");
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(1202), 1e-3, "câmera na varanda logo após o clique");
    await page.keyboard.press("Escape");
    e = await estado(page);
    assert.equal(e.busy, false);
    assert.equal(e.mode, "torre");
  });
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    await cel(page, 1202).click();
    await ocioso(page);
    const antes = (await estado(page)).camera.position;
    await page.click("#e-f-vista");
    assert.equal((await estado(page)).busy, true, "devia haver voo até a varanda");
    assert.equal((await estado(page)).mode, "vista");
    await ocioso(page);
    let e = await estado(page);
    assert.equal(e.busy, false);
    perto(e.camera.position, olho(1202), 1e-3, "câmera no fim do voo");
    assert.ok(dist3(antes, e.camera.position) > 5, "a câmera devia ter saído do lugar");
    assert.ok(e.city.visible);
    // sair: outro voo
    await page.keyboard.press("Escape");
    assert.equal((await estado(page)).busy, true, "devia haver voo de volta à torre");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.city.visible, false, "depois do voo de volta a cidade tem de sumir");
    assert.ok(Math.abs(e.fov - 50) < 20 && Math.abs(e.fov - 62) > 1e-6, `lente da torre: ${e.fov}`);
  });
});

test("vista: sair no meio do voo de entrada não deixa a cidade nem a lente da vista no modo torre", { timeout: 240000 }, async (t) => {
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    await cel(page, 1202).click();
    await ocioso(page);
    const torre = await estado(page);
    await page.click("#e-f-vista");
    await doisQuadros(page);
    assert.equal((await estado(page)).busy, true);
    await page.keyboard.press("Escape");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "torre");
    assert.equal(e.selected, 1202);
    assert.equal(e.city.visible, false, "a cidade ficou ligada depois de sair no meio do voo");
    assert.ok(Math.abs(e.fov - torre.fov) < 1e-9, `lente ficou em ${e.fov}, devia ser ${torre.fov}`);
    // os controles da torre voltaram: arrastar gira a câmera
    const p = await page.evaluate(() => window.MiranteEspelho.screenPoint(1202));
    const antes = (await estado(page)).camera.position;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 5, { steps: 4 });
    await page.mouse.move(p.x + 140, p.y + 10, { steps: 8 });
    await page.mouse.up();
    await ocioso(page);
    assert.ok(dist3(antes, (await estado(page)).camera.position) > 0.5, "o arrasto devia girar a torre de novo");
  });
});

test("vista: trocar de unidade durante o voo termina na varanda da última", { timeout: 240000 }, async (t) => {
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    await cel(page, 1302).click();
    await ocioso(page);
    await page.click("#e-f-vista");
    await doisQuadros(page);
    await clicaCelula(page, 201);
    await doisQuadros(page);
    await clicaCelula(page, 702);
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.selected, 702);
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(702), 1e-3, "câmera da última unidade");
    assert.ok(angulos(e, normalDe(702)).fora > 0.9);
  });
});

test("vista: o modo torre continua funcionando depois de entrar e sair (seleção, vistas, disponibilidade, clique)", { timeout: 240000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const inicial = await estado(page);
    // disponibilidade desligada antes de entrar: continua desligada depois
    await page.click("#e-avail");
    assert.equal((await estado(page)).availability, false);
    await entrar(page, 1302);
    assert.equal((await estado(page)).availability, false, "a vista não pode religar a disponibilidade");
    await page.keyboard.press("Escape");
    await ocioso(page);
    let e = await estado(page);
    assert.equal(e.availability, false, "sair da vista não pode religar a disponibilidade");
    assert.equal(await page.getAttribute("#e-avail", "aria-pressed"), "false");
    assert.equal(await page.locator("#e-panel").evaluate((x) => x.classList.contains("is-avail")), false);
    await page.click("#e-avail");
    assert.equal((await estado(page)).availability, true);

    // e ligada antes de entrar: continua ligada, inclusive dentro da vista
    await page.click("#e-f-vista");               // 1302 continua escolhida depois do Esc
    await ocioso(page);
    assert.equal((await estado(page)).mode, "vista");
    assert.equal((await estado(page)).availability, true);
    await page.click("#e-vista-voltar");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.availability, true);
    assert.equal(await page.locator("#e-panel").evaluate((x) => x.classList.contains("is-avail")), true);

    // vistas prontas
    const pos = {};
    for (const v of ["fachada", "fundos", "aerea"]) {
      await page.click(`#e-views button[data-view="${v}"]`);
      await ocioso(page);
      e = await estado(page);
      assert.equal(e.mode, "torre");
      assert.equal(e.view, v);
      assert.deepEqual(await page.$$eval("#e-views button", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.view)), [v]);
      pos[v] = e.camera.position;
    }
    assert.ok(pos.fachada[2] < 0, "fachada: câmera diante da frente");
    assert.ok(pos.fundos[2] > tower.slab.d, "fundos: câmera atrás da torre");
    assert.ok(pos.aerea[1] > pos.fachada[1] + 10, "aérea: câmera mais alta");
    assert.equal(e.selected, 1302, "trocar de vista mantém a seleção");
    assert.ok(Math.abs(e.fov - inicial.fov) < 1e-9);

    // selecionar outra unidade voa para ela; clicar no modelo seleciona
    await cel(page, 201).click();
    await ocioso(page);
    assert.equal((await estado(page)).selected, 201);
    assert.equal((await estado(page)).mode, "torre");
    await page.click('#e-views button[data-view="fachada"]');
    await ocioso(page);
    const p = await page.evaluate(() => window.MiranteEspelho.screenPoint(802));
    assert.ok(p && p.visible);
    await page.mouse.click(p.x, p.y);
    await ocioso(page);
    assert.equal((await estado(page)).selected, 802);
    assert.deepEqual(await pressionadas(page), [802]);
    // e ainda dá para entrar numa vista nova, a partir da torre de novo
    await page.click("#e-f-vista");
    await ocioso(page);
    e = await estado(page);
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(802), 1e-3, "segunda vista");
  });
});

test("vista: a câmera de volta à torre é a mesma de escolher a unidade direto, sem vista", { timeout: 240000 }, async (t) => {
  if (!browser) return t.skip(motivoSkip);
  let referencia = null;
  await comPagina(t, "?unidade=1302", {}, async ({ page }) => { referencia = await estado(page); });
  if (!referencia) return;
  await comPagina(t, "?unidade=1302&vista=1", {}, async ({ page }) => {
    await page.keyboard.press("Escape");
    await ocioso(page);
    const e = await estado(page);
    mesmaPose(e, referencia, "volta da vista");
    assert.ok(Math.abs(e.fov - referencia.fov) < 1e-9);
  });
});

test("vista: mudar o tamanho da janela dentro da vista não tira a câmera da varanda", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1202&vista=1", {}, async ({ page }) => {
    const antes = await estado(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await doisQuadros(page);
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(1202), 1e-3, "depois de redimensionar");
    assert.ok(Math.abs(e.look.yaw - antes.look.yaw) < 1e-9 && Math.abs(e.look.pitch - antes.look.pitch) < 1e-9);
    assert.ok(Math.abs(e.fov - antes.fov) < 1e-9);
  });
});

test("vista: o aviso 'Vista ilustrativa' está visível de verdade, não coberto, dentro da tela", { timeout: 120000 }, async (t) => {
  await comPagina(t, "?unidade=1302&vista=1", {}, async ({ page }) => {
    await conferirAviso(page, { width: 1280, height: 800 });
  });
});

async function conferirAviso(page, vp) {
  const aviso = page.locator("#e-vista-aviso");
  assert.match(await aviso.innerText(), /Vista ilustrativa/);
  assert.match(await aviso.innerText(), /fictícia/);
  assert.equal(await aviso.isVisible(), true);
  const b = await caixa(page, "#e-vista-aviso");
  assert.ok(b.width > 20 && b.height > 8, `aviso minúsculo: ${b.width}x${b.height}`);
  assert.ok(b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5, `aviso fora da tela: ${JSON.stringify(b)}`);
  const r = await page.evaluate(() => {
    const el = document.getElementById("e-vista-aviso");
    const bx = el.getBoundingClientRect();
    const hit = document.elementFromPoint(bx.left + bx.width / 2, bx.top + bx.height / 2);
    const cs = getComputedStyle(el);
    // a cor do texto e do fundo (o do primeiro ancestral com fundo opaco ou quase) têm de diferir
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    let bg = null;
    for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length < 4 || c[3] > 0.5) { if (c.length) { bg = c; break; } } }
    return {
      coberto: !(hit === el || el.contains(hit)),
      hit: hit && (hit.id || hit.tagName),
      opacity: Number(cs.opacity), visibility: cs.visibility, fontSize: parseFloat(cs.fontSize), color: rgb(cs.color), bg,
      barraOpacity: Number(getComputedStyle(document.getElementById("e-vista")).opacity),
      truncado: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    };
  });
  assert.equal(r.coberto, false, `o aviso está coberto por ${r.hit}`);
  assert.equal(r.opacity, 1);
  assert.equal(r.barraOpacity, 1);
  assert.equal(r.visibility, "visible");
  assert.ok(r.fontSize >= 11, `texto de ${r.fontSize}px`);
  assert.equal(r.truncado, false, "o texto do aviso está cortado");
  assert.ok(r.bg && r.color.length >= 3, "sem cor de fundo para comparar");
  const lum = (c) => { const f = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const [l1, l2] = [lum(r.color), lum(r.bg)].sort((a, c) => c - a);
  assert.ok((l1 + 0.05) / (l2 + 0.05) >= 3, `contraste do aviso ${(((l1 + 0.05) / (l2 + 0.05))).toFixed(2)}:1`);
}

test("vista: celular em pé (375x812): a gaveta fecha, a barra fica dentro da cena, alvos de 44 px, sem rolagem horizontal", { timeout: 180000 }, async (t) => {
  const vp = { width: 375, height: 812 };
  await comPagina(t, "", { viewport: vp, celular: true }, async ({ page }) => {
    await page.click("#e-drawer");
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "true");
    await cel(page, 1302).click();
    await ocioso(page);
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "true", "escolher a unidade abre a gaveta com a ficha");
    const botao = await caixa(page, "#e-f-vista");
    assert.ok(botao.height >= 43.5, `botão da ficha com ${botao.height}px de altura`);
    await page.click("#e-f-vista");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.mode, "vista");
    perto(e.camera.position, olho(1302), 1e-3, "câmera no celular");
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "false", "a gaveta tem de fechar para a cena aparecer");
    assert.equal(await page.locator("#e-panel").evaluate((x) => x.classList.contains("is-open")), false);
    await conferirCelular(page, vp);
    assert.match(await page.locator("#e-hint").innerText(), /dois dedos/, "dica de toque");
    await conferirAviso(page, vp);
    // trocar de andar na vista não reabre a gaveta
    await page.click("#e-vista-abaixo");
    await ocioso(page);
    assert.equal((await estado(page)).selected, 1203);
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "false", "trocar de andar não pode tapar a cena com a gaveta");
    // voltar à torre
    await page.click("#e-vista-voltar");
    await ocioso(page);
    assert.equal((await estado(page)).mode, "torre");
    assert.equal(await page.locator("#e-vista").isHidden(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1, true);
  });
});

test("vista: celular deitado (780x390): barra de uma linha dentro da cena, alvos de 44 px, sem rolagem horizontal", { timeout: 180000 }, async (t) => {
  const vp = { width: 780, height: 390 };
  await comPagina(t, "?unidade=1302&vista=1", { viewport: vp, celular: true }, async ({ page }) => {
    assert.equal((await estado(page)).mode, "vista");
    await conferirCelular(page, vp);
    await conferirAviso(page, vp);
    const barra = await caixa(page, "#e-vista"), cena = await caixa(page, "#e-scene");
    assert.ok(barra.height <= cena.height * 0.45, `a barra ocupa ${(barra.height / cena.height * 100).toFixed(0)}% da altura da cena`);
  });
});

test("vista: celular pequeno (320x568): barra dentro da cena, alvos de 44 px, sem rolagem horizontal", { timeout: 180000 }, async (t) => {
  const vp = { width: 320, height: 568 };
  await comPagina(t, "?unidade=1302&vista=1", { viewport: vp, celular: true }, async ({ page }) => {
    assert.equal((await estado(page)).mode, "vista");
    await conferirCelular(page, vp);
    await conferirAviso(page, vp);
    const barra = await caixa(page, "#e-vista"), cena = await caixa(page, "#e-scene");
    assert.ok(barra.height <= cena.height * 0.5, `a barra ocupa ${(barra.height / cena.height * 100).toFixed(0)}% da altura da cena`);
  });
});

async function conferirCelular(page, vp) {
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(sobra <= 1, `${vp.width}x${vp.height}: rolagem horizontal de ${sobra}px`);
  const cena = await caixa(page, "#e-scene"), barra = await caixa(page, "#e-vista");
  assert.ok(dentro(barra, cena), `${vp.width}x${vp.height}: a barra da vista sai da cena: ${JSON.stringify(barra)} x ${JSON.stringify(cena)}`);
  assert.ok(barra.x >= -0.5 && barra.x + barra.width <= vp.width + 0.5, "a barra sai da tela na horizontal");
  // texto da barra sem corte
  assert.equal(await page.locator("#e-vista").evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), true, "conteúdo da barra cortado");
  // alvos de toque
  for (const sel of ["#e-vista-acima", "#e-vista-abaixo", "#e-vista-voltar"]) {
    const b = await caixa(page, sel);
    assert.ok(b.height >= 43.5 && b.width >= 43.5, `${sel} com ${b.width.toFixed(0)}x${b.height.toFixed(0)}px: menor que 44`);
    assert.ok(dentro(b, barra), `${sel} sai da barra`);
    const hit = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el && (el.closest("button") || el).id; }, [b.x + b.width / 2, b.y + b.height / 2]);
    assert.equal(hit, sel.slice(1), `${sel} está coberto por ${hit}`);
  }
  // nada de sobreposição entre a barra e a dica ou a bússola
  for (const sel of ["#e-hint", "#e-compass"]) {
    if (!(await page.locator(sel).isVisible())) continue;
    const b = await caixa(page, sel);
    assert.ok(!cruzam(barra, b), `${sel} (${JSON.stringify(b)}) se sobrepõe à barra da vista (${JSON.stringify(barra)})`);
  }
  // o horizonte: a barra não pode ficar no alto da cena
  assert.ok(barra.y + barra.height / 2 > cena.y + cena.height / 2, "a barra devia ficar na metade de baixo da cena no celular");
}

test("vista: foco visível na cena e nos botões da barra, na ordem do teclado", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await cel(page, 702).click();
    await ocioso(page);
    await page.click("#e-f-vista");
    await ocioso(page);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "e-canvas", "ao entrar o foco vai para a cena, para as setas olharem");
    const contorno = () => page.evaluate(() => {
      const el = document.activeElement, cs = getComputedStyle(el);
      return { id: el.id, estilo: cs.outlineStyle, largura: parseFloat(cs.outlineWidth), cor: cs.outlineColor, visivel: el.matches(":focus-visible") };
    });
    await page.keyboard.press("Shift");          // última interação por teclado: :focus-visible passa a valer
    let c = await contorno();
    assert.equal(c.id, "e-canvas");
    assert.ok(c.visivel && c.estilo !== "none" && c.largura >= 2, `cena sem contorno de foco: ${JSON.stringify(c)}`);
    const vistos = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      c = await contorno();
      vistos.push(c.id);
      assert.ok(c.visivel && c.estilo !== "none" && c.largura >= 2, `${c.id} sem contorno de foco visível: ${JSON.stringify(c)}`);
      assert.doesNotMatch(c.cor, /rgba\(0, 0, 0, 0\)|transparent/, `${c.id}: contorno transparente`);
    }
    assert.deepEqual(vistos, ["e-vista-acima", "e-vista-abaixo", "e-vista-voltar"], "ordem do Tab dentro da barra");
    // nenhum botão tem o foco escondido: o ativo está dentro da tela
    const b = await caixa(page, "#e-vista-voltar");
    assert.ok(b.y >= 0 && b.y + b.height <= 800);
    // Enter no botão que tem o foco funciona (sai da vista)
    await page.keyboard.press("Enter");
    await ocioso(page);
    assert.equal((await estado(page)).mode, "torre");
  });
});

test("vista: a região viva anuncia a entrada, a troca de unidade e a volta", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const live = page.locator("#e-vista-live");
    assert.equal(await live.getAttribute("role"), "status");
    assert.notEqual(await live.getAttribute("aria-hidden"), "true");
    assert.equal(await live.evaluate((el) => !el.hidden && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden"), true, "região viva escondida de leitor de tela");
    assert.equal((await live.textContent()).trim(), "", "nada anunciado antes da vista");
    await entrar(page, 1302);
    let txt = await live.textContent();
    assert.match(txt, /Vista da varanda do apartamento 1302/);
    assert.match(txt, /13º/);
    assert.match(txt, /ilustrativa/i);
    await page.click("#e-vista-abaixo");
    await ocioso(page);
    txt = await live.textContent();
    assert.match(txt, /apartamento 1203/, `anúncio ao trocar de andar: ${txt}`);
    assert.doesNotMatch(txt, /1302/);
    await page.keyboard.press("Escape");
    await ocioso(page);
    assert.match(await live.textContent(), /De volta à torre/);
    // rótulos acessíveis dos botões da barra, com o número do vizinho
    await entrar(page, 702);
    assert.match(await page.getAttribute("#e-vista-acima", "aria-label"), /802/);
    assert.match(await page.getAttribute("#e-vista-abaixo", "aria-label"), /603/);
    assert.match(await page.getAttribute("#e-canvas", "aria-label"), /ilustrativa/);
    assert.match(await page.getAttribute("#e-canvas", "aria-label"), /Esc para voltar/);
    // o grupo da barra tem nome
    assert.equal(await page.getAttribute("#e-vista", "role"), "group");
    assert.equal(await page.getAttribute("#e-vista", "aria-labelledby"), "e-vista-rotulo");
  });
});

test("vista: sem erro no console nem requisição falha ao entrar, trocar de unidade, mexer no sol e sair, em três tipologias", { timeout: 240000 }, async (t) => {
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    for (const id of [201, 702, 1301]) {
      await cel(page, id).click();
      await ocioso(page);
      await page.click("#e-f-vista");
      await ocioso(page);
      await page.locator("#e-hour").fill("19");
      await page.locator("#e-month").selectOption("12");
      await page.keyboard.press("PageUp");
      await ocioso(page);
      await page.locator("#e-canvas").focus();
      for (const k of ["ArrowLeft", "ArrowUp", "+", "-", "PageDown"]) await page.keyboard.press(k);
      await ocioso(page);
      await page.click("#e-vista-voltar");
      await ocioso(page);
      assert.equal((await estado(page)).mode, "torre");
    }
  });
});
