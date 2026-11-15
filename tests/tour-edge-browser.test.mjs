// Casos de borda da barra de ambientes, vista de topo, mini-mapa e luzes, em
// navegador real. Sem navegador (ou sem WebGL) os testes se pulam.
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
  try { ({ chromium } = await import("playwright-core")); } catch { motivoSkip = "playwright-core não instalado"; return; }
  for (const channel of ["msedge", "chrome"]) {
    try {
      browser = await chromium.launch({ channel, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
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

// Abre uma página já pronta. `motion: true` liga as animações (sem reduced-motion).
async function abrir(t, url, { viewport = { width: 1280, height: 800 }, motion = false, tour = true } = {}) {
  if (!browser) { t.skip(motivoSkip); return null; }
  const ctx = await browser.newContext({ viewport, reducedMotion: motion ? "no-preference" : "reduce" });
  const page = await ctx.newPage();
  const problemas = [];
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // o aviso de GPU do swiftshader não é do site
    if ((m.type() === "error" || m.type() === "warning") && !/GPU stall|swiftshader|GL Driver Message/i.test(m.text())) problemas.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("requestfailed", (r) => problemas.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) problemas.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(`${base}/${url}`, { waitUntil: "load" });
  if (tour) {
    await page.waitForFunction(() => window.MiranteTour || !document.querySelector("#t-fallback").hidden, null, { timeout: 15000 });
    if (await page.locator("#t-fallback").isVisible()) { await ctx.close(); t.skip("este navegador não tem WebGL"); return null; }
  }
  return { ctx, page, problemas };
}
const ocioso = (page) => page.waitForFunction(() => window.MiranteTour.busy === false, null, { timeout: 20000 });
const camera = (page) => page.evaluate(() => window.MiranteTour.camera);
const center = (room) => {
  const xs = room.r.flatMap(([x, , w]) => [x, x + w]), ys = room.r.flatMap(([, y, , h]) => [y, y + h]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
function assertTopo(cam, room, msg) {
  const [cx, cy] = center(room);
  assert.ok(cam.dir[1] < -0.999, `${msg}: não olha reto para baixo (${cam.dir})`);
  assert.ok(Math.abs(cam.target[0] - cx) < 0.01 && Math.abs(cam.target[2] - cy) < 0.01, `${msg}: alvo ${cam.target} fora de ${[cx, cy]}`);
  assert.ok(Math.abs(cam.pos[0] - cx) < 0.05 && Math.abs(cam.pos[2] - cy) < 0.05, `${msg}: câmera descentrada ${cam.pos}`);
}
const dist = (c) => Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]);
// clique via DOM, sem esperar nada: simula toques muito rápidos
const clicarLista = (page, i) => page.evaluate((i) => document.querySelector(`#t-rooms button[data-room="${i}"]`).click(), i);

/* ----------------------------------------------- todas as plantas: topo -- */

for (const p of plans) {
  for (const [nome, viewport] of [["desktop", { width: 1280, height: 800 }], ["celular", { width: 375, height: 812 }], ["ultralargo", { width: 1800, height: 720 }]]) {
    test(`navegador (${nome}): ${p.id}: toda vista de topo fica centrada e a câmera não "pula" ao primeiro toque`, { timeout: 180000 }, async (t) => {
      const s = await abrir(t, `tour.html?planta=${p.id}`, { viewport });
      if (!s) return;
      const { page, ctx, problemas } = s;
      try {
        if (nome === "celular") await page.click("#t-drawer");
        for (let i = 0; i < p.rooms.length; i++) {
          const room = p.rooms[i];
          await page.click("#t-rooms-btn");
          await page.click(`#t-rooms button[data-room="${i}"]`);
          await ocioso(page);
          const antes = await camera(page);
          assertTopo(antes, room, `${nome} ${room.full}`);
          // o centro da vista de topo tem de continuar dentro do ambiente, senão o destaque some sozinho
          await page.waitForFunction((i) => document.querySelector(`#t-minimap path.minimap__room[data-room="${i}"]`).classList.contains("is-current"), i);
          await page.waitForTimeout(100);
          assert.equal(await page.locator("#t-minimap path.minimap__room.is-current").count(), 1, `${room.full}: destaque se perdeu depois do voo`);
          await page.click("#t-rooms-btn"); await page.keyboard.press("Escape");
          // Uma tecla de seta mexe pouco na câmera. Se a vista de topo passasse
          // do limite do controle, o primeiro toque a encolheria de uma vez.
          await page.focus("#t-mode-maquete");
          await page.keyboard.press("ArrowLeft");
          await page.waitForTimeout(120);
          const depois = await camera(page);
          const d0 = dist(antes), d1 = dist(depois);
          assert.ok(Math.abs(d1 - d0) / d0 < 0.03, `${room.full}: distância pulou de ${d0.toFixed(2)} para ${d1.toFixed(2)} (limite do controle)`);
          assert.ok(Math.hypot(depois.target[0] - antes.target[0], depois.target[2] - antes.target[2]) < 0.05, `${room.full}: alvo andou`);
        }
      } finally { await ctx.close(); }
      assert.deepEqual(problemas, []);
    });
  }
}

// Regressão: a vista de topo não se reenquadrava quando a tela mudava de proporção
// (girar o celular, redimensionar a janela), porque resize() só reenquadrava se !userMoved.
test("navegador: girar a tela com um ambiente em vista de topo mantém o ambiente inteiro à vista", { timeout: 60000 }, async (t) => {
  const p = plans.find((q) => q.id === "tres-suites");
  const s = await abrir(t, `tour.html?planta=${p.id}`);
  if (!s) return;
  const { page, ctx } = s;
  try {
    const i = p.rooms.findIndex((r) => r.full === "Estar e jantar");
    await page.click("#t-rooms-btn"); await page.click(`#t-rooms button[data-room="${i}"]`); await ocioso(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
    const cam = await camera(page), cv = await page.locator("#t-canvas").boundingBox();
    const aspect = cv.width / cv.height, meia = (dist(cam) - 2.7) * Math.tan((40 * Math.PI) / 360);
    const xs = p.rooms[i].r.flatMap(([x, , w]) => [x, x + w]);
    const larg = Math.max(...xs) - Math.min(...xs);
    assert.ok(larg / 2 <= meia * aspect, `sala com ${larg.toFixed(1)} m de largura; a tela mostra só ${(2 * meia * aspect).toFixed(1)} m`);
  } finally { await ctx.close(); }
});

/* ------------------------------------------------------------- teclado -- */

test("navegador: barra de ambientes pelo teclado (Enter, Espaço, Esc, Tab, aria-expanded)", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=dois-quartos");
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    const exp = () => page.getAttribute("#t-rooms-btn", "aria-expanded");
    const lista = page.locator("#t-rooms");
    await page.focus("#t-rooms-btn");
    await page.keyboard.press("Enter");
    assert.equal(await exp(), "true"); assert.equal(await lista.isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await exp(), "false"); assert.equal(await lista.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "t-rooms-btn");
    await page.keyboard.press("Space");
    assert.equal(await exp(), "true");
    // Tab entra na lista: o primeiro item é "Apartamento inteiro"
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.room), "-1");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.room), "0");
    // Esc com o foco dentro da lista também fecha e devolve o foco ao botão
    await page.keyboard.press("Escape");
    assert.equal(await exp(), "false");
    assert.equal(await page.evaluate(() => document.activeElement.id), "t-rooms-btn");
    // fechada, os itens não são alcançáveis por Tab
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest("#t-rooms")), false);
    // Enter num item escolhe, fecha e devolve o foco
    await page.focus("#t-rooms-btn");
    await page.keyboard.press("Enter");
    await page.focus('#t-rooms button[data-room="5"]');
    await page.keyboard.press("Enter");
    await ocioso(page);
    assert.equal(await exp(), "false");
    assert.equal(await page.evaluate(() => document.activeElement.id), "t-rooms-btn");
    await page.waitForFunction(() => document.querySelector("#t-rooms-name").textContent === "Suíte");
    // Esc com a lista fechada não rouba o foco
    await page.focus("#t-mode-caminhar");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "t-mode-caminhar");
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

test("navegador: clicar no mini-mapa, no canvas ou no slider com a lista aberta fecha a lista", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=dois-quartos");
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    for (const alvo of ["#t-minimap path.minimap__room", "#t-canvas", "#t-hour"]) {
      await page.click("#t-rooms-btn");
      assert.equal(await page.getAttribute("#t-rooms-btn", "aria-expanded"), "true");
      await page.locator(alvo).first().click();
      assert.equal(await page.getAttribute("#t-rooms-btn", "aria-expanded"), "false", `clique em ${alvo} não fechou`);
      assert.equal(await page.locator("#t-rooms").isVisible(), false);
    }
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

/* ------------------------------------------------- troca de planta/modo -- */

test("navegador: trocar de planta com a barra aberta fecha, refaz lista e mapa e volta à vista geral", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=dois-quartos");
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    await page.click("#t-rooms-btn");
    await clicarLista(page, 3); await ocioso(page);
    await page.click("#t-rooms-btn");
    await page.selectOption("#t-planta", "studio");
    await page.waitForFunction(() => window.MiranteTour.plan === "studio");
    const alvo = plans.find((q) => q.id === "studio");
    assert.equal(await page.getAttribute("#t-rooms-btn", "aria-expanded"), "false");
    assert.equal(await page.locator("#t-rooms").isVisible(), false);
    assert.equal(await page.locator("#t-rooms button").count(), alvo.rooms.length + 1);
    assert.equal(await page.locator("#t-minimap path.minimap__room").count(), alvo.rooms.length);
    assert.equal(await page.locator("#t-minimap .is-current").count(), 0, "destaque da planta anterior sobrou");
    await page.waitForFunction(() => document.querySelector("#t-rooms-name").textContent === "Apartamento inteiro");
    assert.match(await page.locator("#t-rooms-m2").innerText(), /\d/);
    assert.ok((await camera(page)).dir[1] > -0.99, "volta à vista 3/4");
    // trocar de planta em Caminhar: volta à maquete, sem marcador e sem erro
    await page.click("#t-mode-caminhar"); await ocioso(page);
    await page.selectOption("#t-planta", "tres-suites");
    await page.waitForFunction(() => window.MiranteTour.plan === "tres-suites");
    assert.equal(await page.evaluate(() => window.MiranteTour.mode), "maquete");
    assert.equal(await page.locator("#t-minimap .minimap__me").evaluate((e) => getComputedStyle(e).display), "none");
    await page.click("#t-mode-caminhar"); await ocioso(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#t-minimap .minimap__me")).display !== "none");
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

test("navegador (com animação): trocar de planta no meio do voo deixa a câmera na vista geral da planta nova", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=tres-suites", { motion: true });
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    await page.click("#t-rooms-btn");
    await clicarLista(page, 9);
    await page.waitForTimeout(150);                                  // voo de 700 ms em curso
    await page.selectOption("#t-planta", "studio");
    await page.waitForFunction(() => window.MiranteTour.plan === "studio");
    await page.waitForTimeout(1200);
    await ocioso(page);
    const cam = await camera(page);
    assert.ok(cam.dir[1] > -0.99, `câmera ficou de topo depois da troca (${cam.dir})`);
    assert.equal(await page.locator("#t-rooms-name").innerText(), "Apartamento inteiro");
    assert.equal(await page.locator("#t-minimap .is-current").count(), 0);
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

test("navegador (com animação): dois cliques rápidos em ambientes diferentes terminam no segundo", { timeout: 60000 }, async (t) => {
  const p = plans.find((q) => q.id === "tres-suites");
  const s = await abrir(t, `tour.html?planta=${p.id}`, { motion: true });
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    await page.click("#t-rooms-btn");
    await page.evaluate(() => {
      const b = (i) => document.querySelector(`#t-rooms button[data-room="${i}"]`);
      b(1).click(); b(9).click();
    });
    await ocioso(page);
    assertTopo(await camera(page), p.rooms[9], "segundo clique");
    assert.equal(await page.locator("#t-rooms-name").innerText(), p.rooms[9].full);
    assert.equal(await page.locator("#t-minimap path.minimap__room.is-current").count(), 1);
    // e voltando à vista geral logo em seguida
    await page.click("#t-rooms-btn");
    await page.evaluate(() => { const b = (i) => document.querySelector(`#t-rooms button[data-room="${i}"]`); b(4).click(); b(-1).click(); });
    await ocioso(page);
    assert.ok((await camera(page)).dir[1] > -0.99);
    assert.equal(await page.locator("#t-minimap .is-current").count(), 0);
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

for (const motion of [false, true]) {
  test(`navegador (${motion ? "com animação" : "movimento reduzido"}): escolher ambiente no Caminhar e apertar Caminhar logo depois`, { timeout: 90000 }, async (t) => {
    const p = plans.find((q) => q.id === "dois-quartos");
    const s = await abrir(t, `tour.html?planta=${p.id}`, { motion });
    if (!s) return;
    const { page, ctx, problemas } = s;
    try {
      await page.click("#t-mode-caminhar"); await ocioso(page);
      await page.click("#t-rooms-btn");
      await page.evaluate(() => { document.querySelector('#t-rooms button[data-room="5"]').click(); document.querySelector("#t-mode-caminhar").click(); });
      await ocioso(page);
      await page.waitForTimeout(300);
      const modo = await page.evaluate(() => window.MiranteTour.mode);
      // Com animação o segundo clique cai durante o voo e é ignorado; sem animação ele
      // entra de novo no Caminhar. Nos dois casos o estado tem de ser coerente.
      assert.equal(await page.evaluate(() => document.body.dataset.mode), modo);
      assert.equal(await page.getAttribute("#t-mode-caminhar", "aria-pressed"), String(modo === "caminhar"));
      assert.equal(await page.getAttribute("#t-mode-maquete", "aria-pressed"), String(modo === "maquete"));
      if (modo === "maquete") assertTopo(await camera(page), p.rooms[5], "depois do clique duplo");
      else assert.ok(await page.evaluate(() => window.MiranteTour.position), "sem posição no Caminhar");
      // e dá para sair e voltar normalmente
      await page.click(modo === "maquete" ? "#t-mode-caminhar" : "#t-mode-maquete"); await ocioso(page);
      await page.click(modo === "maquete" ? "#t-mode-maquete" : "#t-mode-caminhar"); await ocioso(page);
      assert.equal(await page.evaluate(() => window.MiranteTour.mode), modo);
    } finally { await ctx.close(); }
    assert.deepEqual(problemas, []);
  });
}

/* ------------------------------------------------------------- luzes -- */

// À noite, a imagem do canvas muda quando as luzes acendem e volta quando apagam.
test("navegador: luzes da casa mudam de fato a imagem à noite, na maquete e no Caminhar, e apagadas voltam ao igual", { timeout: 90000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=studio");
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    await page.evaluate(() => { const h = document.querySelector("#t-hour"); h.value = "22"; h.dispatchEvent(new Event("input", { bubbles: true })); });
    const foto = async () => { await page.waitForTimeout(250); return (await page.locator("#t-canvas").screenshot()).toString("base64"); };
    for (const m of ["maquete", "caminhar"]) {
      if (m === "caminhar") { await page.click("#t-mode-caminhar"); await ocioso(page); }
      const apagada = await foto();
      await page.click("#t-lights");
      const acesa = await foto();
      assert.notEqual(acesa, apagada, `${m}: acender não mudou a imagem`);
      await page.click("#t-light-branca");
      const branca = await foto();
      assert.notEqual(branca, acesa, `${m}: trocar a cor não mudou a imagem`);
      await page.click("#t-lights");
      await page.click("#t-light-amarela");
      assert.equal(await foto(), apagada, `${m}: apagada não voltou ao mesmo quadro`);
    }
    // a luz ligada sobrevive à ida e volta entre os modos
    await page.click("#t-lights");
    await page.click("#t-mode-maquete"); await ocioso(page);
    assert.equal((await page.evaluate(() => window.MiranteTour.lights)).on, true);
    await page.click("#t-mode-caminhar"); await ocioso(page);
    assert.equal(await page.getAttribute("#t-lights", "aria-pressed"), "true");
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

test("navegador: ao meio-dia as luzes acesas quase não mudam a imagem da maquete", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=studio");
  if (!s) return;
  const { page, ctx } = s;
  try {
    const foto = async () => { await page.waitForTimeout(250); return (await page.locator("#t-canvas").screenshot()).toString("base64"); };
    const a = await foto();
    await page.click("#t-lights");
    const b = await foto();
    // decodifica os dois PNG no próprio navegador e mede a diferença média por canal
    const media = await page.evaluate(async ([x, y]) => {
      const px = async (b64) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q] = [await px(x), await px(y)];
      let soma = 0; for (let i = 0; i < p.length; i++) if (i % 4 !== 3) soma += Math.abs(p[i] - q[i]);
      return soma / (p.length * 0.75);
    }, [a, b]);
    assert.ok(media < 6, `diferença média ${media.toFixed(2)} (de 255) grande demais para o meio-dia`);
  } finally { await ctx.close(); }
});

/* ------------------------------------------------------------- celular -- */

test("navegador (375x812): gaveta, barra e mini-mapa usáveis, sem rolagem horizontal", { timeout: 90000 }, async (t) => {
  const s = await abrir(t, "tour.html?planta=tres-suites", { viewport: { width: 375, height: 812 } });
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    const semOverflow = async (msg) => {
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
      assert.ok(o.sw <= o.cw && o.bw <= o.cw, `${msg}: overflow horizontal ${JSON.stringify(o)}`);
    };
    await semOverflow("fechado");
    assert.equal(await page.locator("#t-minimap").isVisible(), false, "mini-mapa escondido com a gaveta fechada");
    await page.click("#t-drawer");
    assert.equal(await page.getAttribute("#t-drawer", "aria-expanded"), "true");
    await semOverflow("gaveta aberta");
    const cabe = async (sel, msg) => {
      const b = await page.locator(sel).boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= 375.5 && b.width > 20 && b.height > 20, `${msg}: ${JSON.stringify(b)}`);
      return b;
    };
    const mapa = await cabe("#t-minimap svg", "mini-mapa");
    assert.ok(mapa.height >= 60, `mini-mapa pequeno demais para tocar: ${mapa.height}px`);
    const barra = await cabe("#t-rooms-btn", "barra");
    assert.ok(barra.height >= 40, `alvo de toque da barra ${barra.height}px`);
    await page.locator('#t-minimap path.minimap__room[data-room="12"]').click();
    await ocioso(page);
    await page.waitForFunction(() => document.querySelector("#t-rooms-name").textContent === "Suíte 3");
    await page.click("#t-rooms-btn");
    await semOverflow("lista aberta");
    const ult = page.locator("#t-rooms button").last();
    await ult.scrollIntoViewIfNeeded();
    const bu = await ult.boundingBox();
    assert.ok(bu && bu.y >= 0 && bu.y + bu.height <= 812, `último item fora da tela: ${JSON.stringify(bu)}`);
    await ult.click();
    await ocioso(page);
    assert.equal(await page.getAttribute("#t-rooms-btn", "aria-expanded"), "false");
    await page.click("#t-rooms-btn");
    const pn = await page.locator("#t-panel").boundingBox();
    assert.ok(pn.y >= 0 && pn.y + pn.height <= 812.5, `painel estourou a tela ${JSON.stringify(pn)}`);
    const cv = await page.locator("#t-canvas").boundingBox();
    assert.ok(cv.height > 200, `canvas espremido: ${cv.height}px`);
    await page.click("#t-rooms-btn");
    await page.locator("#t-lights").scrollIntoViewIfNeeded();
    await page.click("#t-lights");
    await page.click("#t-light-branca");
    await semOverflow("final");
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});

/* ------------------------------------------------- sem erro em todas -- */

for (const p of plans) {
  test(`navegador: tour.html?planta=${p.id} sem erros nem avisos no console, com luzes ligadas e passeio`, { timeout: 90000 }, async (t) => {
    const s = await abrir(t, `tour.html?planta=${p.id}`);
    if (!s) return;
    const { page, ctx, problemas } = s;
    try {
      await page.click("#t-lights");
      await page.click("#t-mode-caminhar"); await ocioso(page);
      await page.click("#t-rooms-btn"); await clicarLista(page, p.rooms.length - 1); await ocioso(page);
      await page.click("#t-mode-caminhar"); await ocioso(page);
      await page.locator("#t-minimap path.minimap__room").first().click({ force: true });
      await ocioso(page);
    } finally { await ctx.close(); }
    assert.deepEqual(problemas, []);
  });
}

/* --------------------------------------------------------------- espelho -- */

test("navegador: espelho.html mantém o interruptor (.switch) e não tem erros nem avisos", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, "espelho.html", { tour: false });
  if (!s) return;
  const { page, ctx, problemas } = s;
  try {
    await page.waitForSelector("#e-avail");
    await page.waitForTimeout(500);
    const css = await page.evaluate(() => {
      const b = document.querySelector("#e-avail"), tr = b.querySelector(".switch__track");
      const cs = (e, ...k) => Object.fromEntries(k.map((x) => [x, getComputedStyle(e)[x]]));
      return {
        btn: cs(b, "display", "cursor", "borderTopWidth"),
        track: cs(tr, "width", "height", "position"),
        after: { content: getComputedStyle(tr, "::after").content },
        pressed: b.getAttribute("aria-pressed"),
      };
    });
    assert.ok(["inline-flex", "flex"].includes(css.btn.display), css.btn.display);   // "flex" quando vira item de grade
    assert.equal(css.btn.cursor, "pointer");
    assert.notEqual(css.btn.borderTopWidth, "0px");
    assert.equal(css.track.position, "relative");
    assert.ok(parseFloat(css.track.width) > 20 && parseFloat(css.track.height) > 10, JSON.stringify(css.track));
    assert.notEqual(css.after.content, "none");
    await page.click("#e-avail");
    assert.notEqual(await page.getAttribute("#e-avail", "aria-pressed"), css.pressed, "o interruptor não alternou");
  } finally { await ctx.close(); }
  assert.deepEqual(problemas, []);
});
