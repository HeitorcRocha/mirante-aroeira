// Trilho das áreas comuns da landing (index.html, seção .comuns) em navegador
// real. Usa o playwright-core já instalado e um navegador do sistema (Edge ou
// Chrome). Sem navegador, os testes se pulam.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".json": "application/json",
};

let browser = null, server = null, base = "", motivoSkip = "";

before(async () => {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    motivoSkip = "playwright-core não instalado";
    return;
  }
  for (const channel of ["msedge", "chrome"]) {
    try {
      browser = await chromium.launch({ channel, headless: true });
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

async function abrir(t, viewport) {
  if (!browser) { t.skip(motivoSkip); return null; }
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problemas = [];
  page.on("console", (m) => { if (m.type() === "error") problemas.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/index.html`, { waitUntil: "load" });
  t.after(() => ctx.close());
  return { page, problemas };
}

// Rola até uma fração do percurso da seção e espera o motor pintar o quadro.
async function rolar(page, fracao, extra = 0) {
  return page.evaluate(async ([f, px]) => {
    const sec = document.querySelector(".comuns");
    const rail = sec.querySelector("[data-sc-pan]");
    const top = sec.getBoundingClientRect().top + scrollY;
    scrollTo({ top: top + (sec.offsetHeight - innerHeight) * f + px, behavior: "instant" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const figs = [...sec.querySelectorAll("figure")];
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return {
      tx: new DOMMatrix(getComputedStyle(rail).transform).m41,
      larguraTrilho: rail.scrollWidth,
      vw: innerWidth, vh: innerHeight,
      primeira: box(figs[0]), ultima: box(figs[figs.length - 1]),
      nota: box(sec.querySelector(".comuns__note")),
      palco: box(sec.querySelector("[data-sc-stage]")),
      ficha: box(document.querySelector("#ficha h2")),
    };
  }, [fracao, extra]);
}

for (const [nome, viewport] of [["celular", { width: 375, height: 812 }], ["desktop", { width: 1280, height: 800 }]]) {
  test(`navegador (${nome}): o trilho das áreas comuns anda com o scroll, do início ao fim`, { timeout: 60000 }, async (t) => {
    const s = await abrir(t, viewport);
    if (!s) return;
    const a = await rolar(s.page, 0), m = await rolar(s.page, 0.5), z = await rolar(s.page, 1);
    assert.ok(a.larguraTrilho > a.vw, "o trilho é mais largo que a tela");
    assert.ok(Math.abs(a.tx) < 1, `no início o trilho está parado (tx = ${a.tx})`);
    assert.ok(m.tx < a.tx - 50 && z.tx < m.tx - 50, `o trilho anda para a esquerda: ${a.tx} > ${m.tx} > ${z.tx}`);
    // no fim, o último bloco (a frase) está inteiro na tela
    assert.ok(z.nota.left >= -1 && z.nota.right <= z.vw + 1, `a frase final cabe na tela: ${z.nota.left}..${z.nota.right}`);
    // voltar ao início devolve o trilho (o motor não guarda um valor velho)
    const volta = await rolar(s.page, 0);
    assert.ok(Math.abs(volta.tx - a.tx) < 1, "rolar de volta devolve o trilho ao início");
    assert.deepEqual(s.problemas, []);
  });
}

// 320 px é a tela mais estreita que a página atende: a legenda quebra em mais
// linhas e é onde o palco (overflow: clip) cortaria primeiro.
for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 812 }, { width: 414, height: 896 }]) {
  test(`navegador (celular ${viewport.width}x${viewport.height}): o palco das áreas comuns tem a altura do conteúdo e a ficha vem logo depois`, { timeout: 60000 }, async (t) => {
    const s = await abrir(t, viewport);
    if (!s) return;
    const meio = await rolar(s.page, 0.5);
    const alturaPalco = meio.palco.bottom - meio.palco.top;
    assert.ok(alturaPalco < meio.vh * 0.92, `palco menor que a tela (${alturaPalco} de ${meio.vh})`);
    // preso e centrado na tela enquanto o trilho anda
    const folgaCima = meio.palco.top, folgaBaixo = meio.vh - meio.palco.bottom;
    assert.ok(Math.abs(folgaCima - folgaBaixo) < 2, `palco centrado: ${folgaCima} em cima, ${folgaBaixo} embaixo`);
    // a foto e a legenda cabem no palco com folga (ele corta o que passar)
    const sobra = Math.min(meio.primeira.top - meio.palco.top, meio.palco.bottom - meio.primeira.bottom);
    assert.ok(sobra >= 12, `a foto e a legenda cabem no palco com folga (sobra ${sobra}px)`);

    // depois da seção, o título da ficha fica perto da última legenda; com o
    // palco em 100svh esse vão passava de 200 px
    const depois = await rolar(s.page, 1, 500);
    const vao = depois.ficha.top - depois.ultima.bottom;
    assert.ok(vao > 0 && vao < 140, `vão entre a última legenda e "Ficha técnica": ${vao}px`);
    assert.deepEqual(s.problemas, []);
  });
}

test("navegador (celular, fonte 150%): a legenda das áreas comuns não é cortada pelo palco", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, { width: 375, height: 812 });
  if (!s) return;
  await s.page.addStyleTag({ content: "html { font-size: 150%; }" });
  await s.page.setViewportSize({ width: 376, height: 812 });   // força o motor a medir de novo
  const meio = await rolar(s.page, 0.5);
  assert.ok(meio.primeira.bottom <= meio.palco.bottom, `legenda dentro do palco: ${meio.primeira.bottom} <= ${meio.palco.bottom}`);
  assert.ok(meio.primeira.top >= meio.palco.top, "foto dentro do palco");
});

// O trilho tem dois motores: animação CSS ligada ao scroll, onde o navegador
// tem, e transform escrito pelo motor em JS, onde não tem. Os dois têm de
// parar nos mesmos lugares.
test("navegador (celular): trilho por CSS e trilho por JS param nas mesmas posições", { timeout: 60000 }, async (t) => {
  if (!browser) return t.skip(motivoSkip);
  const medir = async (semCss) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    if (semCss) await page.addInitScript(() => {
      const real = CSS.supports.bind(CSS);
      CSS.supports = (...a) => (String(a[0]).includes("animation-timeline") ? false : real(...a));
    });
    await page.goto(`${base}/index.html`, { waitUntil: "load" });
    const porCss = await page.evaluate(() => document.querySelector(".comuns [data-sc-pan]").classList.contains("sc-pan--css"));
    const tx = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) tx.push(Math.round((await rolar(page, f)).tx));
    return { porCss, tx };
  };
  const js = await medir(true);
  assert.equal(js.porCss, false, "sem suporte a animation-timeline o motor fica no JS");
  assert.ok(js.tx[4] < -100, `o trilho por JS anda: ${js.tx}`);
  const css = await medir(false);
  if (!css.porCss) return t.skip("este navegador não tem animação ligada ao scroll");
  css.tx.forEach((x, i) => assert.ok(Math.abs(x - js.tx[i]) <= 1, `posição ${i}: CSS ${x}, JS ${js.tx[i]}`));
});

test("navegador (desktop): o palco das áreas comuns continua com a altura da tela", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, { width: 1280, height: 800 });
  if (!s) return;
  const meio = await rolar(s.page, 0.5);
  assert.ok(Math.abs((meio.palco.bottom - meio.palco.top) - meio.vh) < 2, "palco = altura da tela");
  assert.ok(Math.abs(meio.palco.top) < 2, "palco preso no topo");
});

test("navegador (celular): as fotos das áreas comuns já estão carregadas antes de a seção chegar", { timeout: 60000 }, async (t) => {
  const s = await abrir(t, { width: 375, height: 812 });
  if (!s) return;
  // para uma tela e meia antes da seção: as fotos ainda estão fora da tela
  await s.page.evaluate(() => {
    const sec = document.querySelector(".comuns");
    scrollTo({ top: sec.getBoundingClientRect().top + scrollY - innerHeight * 1.5, behavior: "instant" });
  });
  await s.page.waitForFunction(() => [...document.querySelectorAll(".comuns img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 })
    .catch(() => { throw new Error("as fotos do trilho não carregaram antes de a seção entrar na tela"); });
});
