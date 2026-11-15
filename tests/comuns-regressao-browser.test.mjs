// Regressão do trilho das áreas comuns (index.html, seção .comuns) depois que o
// motor passou a guardar a sobra do trilho (railOver) e a só reescrever
// --sc-p, o transform e --sc-canvas quando o valor muda. Complementa
// comuns-browser.test.mjs. Usa o playwright-core e um navegador do sistema
// (Edge ou Chrome); sem navegador, os testes se pulam.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".json": "application/json",
};

let browser = null, server = null, base = "", motivoSkip = "";
let atrasoFontes = 0; // ms de atraso nas fontes, ajustável por teste

before(async () => {
  let chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { motivoSkip = "playwright-core não instalado"; return; }
  for (const channel of ["msedge", "chrome"]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* tenta o próximo */ }
  }
  if (!browser) { motivoSkip = "nenhum navegador do sistema (Edge/Chrome) disponível"; return; }
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("404"); return; }
    const enviar = () => { res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res); };
    if (atrasoFontes && file.endsWith(".woff2")) setTimeout(enviar, atrasoFontes); else enviar();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

async function abrir(t, viewport, opcoes = {}) {
  if (!browser) { t.skip(motivoSkip); return null; }
  const ctx = await browser.newContext({ viewport, ...opcoes });
  const page = await ctx.newPage();
  const problemas = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problemas.push(`console.${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(400);
  t.after(() => ctx.close());
  return { page, problemas };
}

const irPara = (page, y) => page.evaluate(async (y) => {
  scrollTo({ top: y, behavior: "instant" });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, y);

const geometriaSecao = (page) => page.evaluate(() => {
  const s = document.querySelector(".comuns");
  return { top: s.getBoundingClientRect().top + scrollY, h: s.offsetHeight, vh: innerHeight };
});

const estadoTrilho = (page) => page.evaluate(() => {
  const sec = document.querySelector(".comuns"), rail = sec.querySelector("[data-sc-pan]");
  const nota = sec.querySelector(".comuns__note").getBoundingClientRect();
  return { tx: new DOMMatrix(getComputedStyle(rail).transform).m41, vw: innerWidth, notaDir: nota.right, notaEsq: nota.left };
});

// Início e fim do trilho: parado em 0 no começo, última frase inteira na tela
// (e sem sobrar um vazio enorme à direita, o que indicaria uma sobra velha).
async function verificarExtremos(page, rotulo) {
  const g = await geometriaSecao(page);
  await irPara(page, g.top);
  const ini = await estadoTrilho(page);
  await irPara(page, g.top + g.h - g.vh);
  const fim = await estadoTrilho(page);
  await irPara(page, g.top - 5);
  await irPara(page, g.top);
  const volta = await estadoTrilho(page);
  assert.ok(Math.abs(ini.tx) < 1, `${rotulo}: início parado (tx = ${ini.tx})`);
  assert.ok(fim.notaDir <= fim.vw + 1, `${rotulo}: a frase final passa da borda direita (${fim.notaDir} > ${fim.vw}); sobra do trilho velha?`);
  assert.ok(fim.notaDir >= fim.vw * 0.6, `${rotulo}: o trilho foi além do necessário, sobrou vazio à direita (${fim.notaDir} de ${fim.vw})`);
  assert.ok(Math.abs(volta.tx) < 1, `${rotulo}: voltar ao início devolve o trilho (tx = ${volta.tx})`);
}

for (const [nome, sequencia] of [
  ["celular girado", [[375, 812], [812, 375], [375, 812]]],
  ["desktop estreitado", [[1280, 800], [700, 800], [1280, 800]]],
]) {
  test(`navegador (${nome}): depois de redimensionar o trilho ainda chega ao fim e volta a 0`, { timeout: 90000 }, async (t) => {
    const s = await abrir(t, { width: sequencia[0][0], height: sequencia[0][1] });
    if (!s) return;
    await verificarExtremos(s.page, `${sequencia[0]}`);
    for (const [w, h] of sequencia.slice(1)) {
      await s.page.setViewportSize({ width: w, height: h });
      await s.page.waitForTimeout(400);
      await verificarExtremos(s.page, `depois de ${w}x${h}`);
    }
    assert.deepEqual(s.problemas, []);
  });
}

// --sc-p de cada ato contra o valor calculado da geometria. O hero fica de
// fora: tem dwell (curva própria), que a fórmula simples não conhece.
function lerProgressos(page) {
  return page.evaluate(() => {
    const vh = innerHeight, y = scrollY, res = [];
    document.querySelectorAll("[data-sc-act]").forEach((el) => {
      const act = el.dataset.scAct;
      if (el.dataset.scDwell) return;
      const r = el.getBoundingClientRect(), top = r.top + y, h = r.height;
      const preso = act === "pin" || act === "pan" || act === "scrub";
      const esperado = preso
        ? Math.min(1, Math.max(0, (y - top) / Math.max(h - vh, 1)))
        : Math.min(1, Math.max(0, (y + vh - top) / (h + vh)));
      res.push({ id: el.id || el.className.split(" ")[0], act, esperado, obtido: parseFloat(el.style.getPropertyValue("--sc-p")) });
    });
    return res;
  });
}

async function percorrerComparando(page, rotulo) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const pontos = [];
  for (let y = 0; y <= total; y += 173) pontos.push(y);
  pontos.push(total);
  const divergencias = [];
  let comparados = 0;
  for (const [sentido, lista] of [["descendo", pontos], ["subindo", [...pontos].reverse()]]) {
    for (const y of lista) {
      await irPara(page, y);
      for (const x of await lerProgressos(page)) {
        comparados++;
        if (!(Math.abs(x.esperado - x.obtido) < 0.0006)) divergencias.push(`${rotulo} ${sentido} y=${y} ${x.id}: esperado ${x.esperado.toFixed(4)}, obtido ${x.obtido}`);
      }
    }
  }
  assert.ok(comparados > 50, "comparou poucos pontos");
  assert.deepEqual(divergencias.slice(0, 5), [], `${divergencias.length} divergências de --sc-p`);
}

for (const [nome, viewport, girado] of [
  ["celular", { width: 375, height: 812 }, { width: 812, height: 375 }],
  ["desktop", { width: 1280, height: 800 }, { width: 700, height: 800 }],
]) {
  test(`navegador (${nome}): --sc-p de todos os atos bate com a geometria, descendo, subindo e depois de redimensionar`, { timeout: 120000 }, async (t) => {
    const s = await abrir(t, viewport);
    if (!s) return;
    await percorrerComparando(s.page, `${viewport.width}x${viewport.height}`);
    await s.page.setViewportSize(girado);
    await s.page.waitForTimeout(400);
    await percorrerComparando(s.page, `${girado.width}x${girado.height}`);
  });
}

test("navegador: a cor de fundo (drift) muda entre seções e volta igual ao rolar de volta", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, { width: 1280, height: 800 });
  if (!s) return;
  const atos = await s.page.evaluate(() => [...document.querySelectorAll("[data-sc-act]")].map((e) => ({ id: e.id || e.className.split(" ")[0], top: e.getBoundingClientRect().top + scrollY, h: e.offsetHeight })));
  const cor = () => s.page.evaluate(() => document.documentElement.style.getPropertyValue("--sc-canvas"));
  const ida = {}, volta = {};
  for (const a of atos) { await irPara(s.page, a.top + a.h * 0.6); ida[a.id] = await cor(); }
  for (const a of [...atos].reverse()) { await irPara(s.page, a.top + a.h * 0.6); volta[a.id] = await cor(); }
  assert.ok(new Set(Object.values(ida)).size >= 4, `o fundo quase não muda entre as seções: ${JSON.stringify(ida)}`);
  assert.deepEqual(volta, ida, "ao voltar, cada seção deve ter a mesma cor de fundo de quando se desceu");
});

for (const [nome, viewport] of [["celular", { width: 375, height: 812 }], ["desktop", { width: 1280, height: 800 }]]) {
  test(`navegador (${nome}, movimento reduzido): o trilho vira uma região rolável e todos os blocos são alcançáveis`, { timeout: 60000 }, async (t) => {
    const s = await abrir(t, viewport, { reducedMotion: "reduce" });
    if (!s) return;
    const r = await s.page.evaluate(async () => {
      const palco = document.querySelector(".comuns [data-sc-stage]"), trilho = palco.querySelector("[data-sc-pan]");
      const antes = palco.scrollLeft;
      palco.scrollLeft = 1e6;
      await new Promise((ok) => setTimeout(ok, 100));
      const nota = trilho.querySelector(".comuns__note").getBoundingClientRect(), caixa = palco.getBoundingClientRect();
      return { overflowX: getComputedStyle(palco).overflowX, transform: getComputedStyle(trilho).transform, antes, depois: palco.scrollLeft, notaDir: nota.right, palcoDir: caixa.right, notaEsq: nota.left, palcoEsq: caixa.left };
    });
    assert.equal(r.overflowX, "auto");
    assert.equal(r.transform, "none", "sem movimento, o motor não deve transladar o trilho");
    assert.ok(r.depois > r.antes + 100, "o trilho tem de ser rolável na horizontal");
    assert.ok(r.notaEsq >= r.palcoEsq - 1 && r.notaDir <= r.palcoDir + 1, "no fim da rolagem a frase final está dentro do palco");
  });
}

// Desktop não pode mudar com o ajuste de celular: palco com a altura da tela,
// preso no topo (inclusive logo acima do breakpoint de 860px).
for (const [w, h] of [[1280, 800], [1920, 1080], [861, 700]]) {
  test(`navegador (${w}x${h}): o palco das áreas comuns tem a altura da tela e gruda no topo`, { timeout: 60000 }, async (t) => {
    const s = await abrir(t, { width: w, height: h });
    if (!s) return;
    const g = await geometriaSecao(s.page);
    await irPara(s.page, g.top + (g.h - g.vh) * 0.5);
    const r = await s.page.evaluate(() => { const b = document.querySelector(".comuns [data-sc-stage]").getBoundingClientRect(); return { top: b.top, h: b.height, vh: innerHeight }; });
    assert.ok(Math.abs(r.h - r.vh) < 1, `altura do palco ${r.h} != tela ${r.vh}`);
    assert.ok(Math.abs(r.top) < 1, `palco fora do topo: ${r.top}`);
  });
}

// Celulares em pé: tudo cabe dentro do palco, que é mais baixo que a tela.
for (const [w, h] of [[320, 568], [375, 667], [375, 812], [414, 896]]) {
  test(`navegador (celular ${w}x${h}): texto de abertura, fotos e legendas cabem no palco; vão até a ficha é curto; sem rolagem horizontal`, { timeout: 60000 }, async (t) => {
    const s = await abrir(t, { width: w, height: h });
    if (!s) return;
    const g = await geometriaSecao(s.page);
    await irPara(s.page, g.top + (g.h - g.vh) * 0.5);
    const r = await s.page.evaluate(() => {
      const caixa = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom }; };
      const sec = document.querySelector(".comuns"), palco = caixa(sec.querySelector("[data-sc-stage]"));
      const partes = [".comuns__lead h2", ".comuns__lead p", ".comuns__note", ...[...sec.querySelectorAll("figure")].flatMap((_, i) => [`figure:nth-of-type(${i + 1}) img`, `figure:nth-of-type(${i + 1}) figcaption`])]
        .map((q) => ({ q, ...caixa(sec.querySelector(q)) }));
      return { palco, partes, vh: innerHeight, largura: document.documentElement.scrollWidth, vw: innerWidth };
    });
    for (const p of r.partes) {
      assert.ok(p.t >= r.palco.t - 0.5 && p.b <= r.palco.b + 0.5, `${p.q} cortado pelo palco: ${p.t.toFixed(1)}..${p.b.toFixed(1)} fora de ${r.palco.t.toFixed(1)}..${r.palco.b.toFixed(1)}`);
    }
    assert.ok(r.palco.b - r.palco.t < r.vh, "o palco deveria ser mais baixo que a tela");
    assert.equal(r.largura, r.vw, "a página não pode rolar na horizontal");
    // vão entre a última legenda e o título da ficha, com a seção já fora do pin
    await irPara(s.page, g.top + g.h);
    const vao = await s.page.evaluate(() => {
      const legendas = [...document.querySelectorAll(".comuns figcaption")];
      return document.querySelector("#ficha h2").getBoundingClientRect().top - Math.max(...legendas.map((l) => l.getBoundingClientRect().bottom));
    });
    assert.ok(vao > 0 && vao < 120, `vão entre a última legenda e a ficha: ${vao}px`);
  });
}

// Defeito já existente em HEAD (não vem desta mudança): na horizontal a foto
// (78vw de largura, 4:5) é mais alta que a tela e o palco corta o conteúdo.
// Marcado como todo: aparece no relatório sem derrubar a suíte.
test("navegador (celular deitado 812x375): fotos e legendas cabem no palco", { todo: "foto 4:5 de 78vw é mais alta que a tela deitada; já era assim em HEAD", timeout: 60000 }, async (t) => {
  const s = await abrir(t, { width: 812, height: 375 });
  if (!s) return;
  const g = await geometriaSecao(s.page);
  await irPara(s.page, g.top + (g.h - g.vh) * 0.5);
  const r = await s.page.evaluate(() => {
    const palco = document.querySelector(".comuns [data-sc-stage]").getBoundingClientRect();
    const f = document.querySelector(".comuns figure").getBoundingClientRect();
    return { palcoT: palco.top, palcoB: palco.bottom, figT: f.top, figB: f.bottom };
  });
  assert.ok(r.figT >= r.palcoT - 0.5 && r.figB <= r.palcoB + 0.5, `figura ${r.figT.toFixed(0)}..${r.figB.toFixed(0)} fora do palco ${r.palcoT}..${r.palcoB}`);
});

// Mudança tardia de layout: com as fontes chegando devagar, a largura do trilho
// pode mudar depois do primeiro layout() (320px: a troca da fonte reserva 3px a
// mais). O motor mede de novo em fonts.ready; a sobra guardada não pode ficar
// velha e cortar a última frase.
test("navegador (celular 320x568, fontes lentas): depois da troca de fonte o fim do trilho continua alcançável", { timeout: 60000 }, async (t) => {
  atrasoFontes = 1500;
  t.after(() => { atrasoFontes = 0; });
  const s = await abrir(t, { width: 320, height: 568 });
  if (!s) return;
  await s.page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 15000 });
  await s.page.waitForTimeout(300);
  const r = await s.page.evaluate(() => {
    const a = ScrollCraft.instances[0].acts.find((x) => x.rail);
    return { guardada: a.railOver, real: a.rail.scrollWidth - innerWidth };
  });
  assert.equal(r.guardada, r.real, "a sobra guardada do trilho ficou diferente da real depois das fontes");
  await verificarExtremos(s.page, "320x568 com fontes lentas");
});
