// Espelho de vendas em navegador real. Mesmo padrão de tour-browser.test.mjs:
// playwright-core, Edge/Chrome do sistema, servidor HTTP mínimo; se não houver
// navegador ou WebGL, os testes se pulam. Espera por MiranteEspelho.busy, não
// por timers fixos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tower } from "../data/tower.js";
import { plans } from "../data/plans.js";
import { countUnits, unitSunHours, unitSunlit, buildTower } from "../tour/tower.js";
import { sunPosition, formatHour, MONTHS } from "../tour/sun.js";

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
const built = buildTower(tower, plans);
const centerOf = (id) => built.units.find((u) => u.id === id).center;   // [x, y, z] da laje; na cena: X = x, Y = z, Z = y
const sceneCenter = (id) => { const [x, y, z] = centerOf(id); return [x, z, y]; };
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vendida = tower.units.find((u) => u.status === "vendida");
const reservada = tower.units.find((u) => u.status === "reservada");
const disponivel = tower.units.find((u) => u.status === "disponivel");

/**
 * Abre uma página nova. Devolve null (e o teste deve pular) se a página caiu no
 * plano B por falta de WebGL. Devolve { page, ctx, problemas, fechar }.
 */
async function abrir(query = "", { reduzido = true, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduzido ? "reduce" : "no-preference" });
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
const estado = (page) => page.evaluate(() => ({
  selected: window.MiranteEspelho.selected, view: window.MiranteEspelho.view, filter: window.MiranteEspelho.filter,
  availability: window.MiranteEspelho.availability, busy: window.MiranteEspelho.busy, camera: window.MiranteEspelho.camera,
  search: location.search,
}));
const pressionadas = (page) => page.$$eval("#e-grid button[data-unit]", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.dataset.unit)));
const doisQuadros = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function clicarNoModelo(page, id) {
  const p = await page.evaluate((i) => window.MiranteEspelho.screenPoint(i), id);
  assert.ok(p && p.visible, `unidade ${id} não está visível na tela (${JSON.stringify(p)})`);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  return p;
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

/* ---------------------------------------------------------------- testes -- */

test("navegador: espelho.html abre sem erro; 62 botões de unidade, todos com aria-label", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    assert.match(await page.title(), /Espelho de vendas/);
    const botoes = page.locator("#e-grid button[data-unit]");
    assert.equal(await botoes.count(), 62);
    const dados = await botoes.evaluateAll((bs) => bs.map((b) => ({ id: Number(b.dataset.unit), label: b.getAttribute("aria-label"), role: b.closest("[role=gridcell]") ? "cell" : "", pressed: b.getAttribute("aria-pressed") })));
    for (const d of dados) {
      assert.ok(d.label && d.label.trim(), `botão ${d.id} sem aria-label`);
      assert.match(d.label, new RegExp(`Apartamento ${d.id}\\b`), `rótulo de ${d.id}: ${d.label}`);
      assert.equal(d.role, "cell", `botão ${d.id} fora de um gridcell`);
      assert.equal(d.pressed, "false");
    }
    assert.equal(new Set(dados.map((d) => d.label)).size, 62, "rótulos repetidos");
    assert.deepEqual(dados.map((d) => d.id).sort((a, b) => a - b), tower.units.map((u) => u.id).sort((a, b) => a - b));
    const units = await page.evaluate(() => window.MiranteEspelho.units);
    assert.deepEqual([...units].sort((a, b) => a - b), tower.units.map((u) => u.id).sort((a, b) => a - b), "modelo 3D e grade com unidades diferentes");
    // estado inicial
    const e = await estado(page);
    assert.equal(e.selected, null);
    assert.equal(e.view, "fachada");
    assert.equal(e.availability, true);
    assert.equal(e.filter, "");
    assert.equal(await page.locator("#e-ficha-corpo").isHidden(), true);
    assert.equal(await page.locator("#e-status").isHidden(), true, "o 'Carregando' tem de sumir");
    // resumo inicial bate com os dados
    const n = countUnits(tower);
    assert.match(await page.locator("#e-resumo").innerText(), new RegExp(`${n.total} unidades.*${n.disponivel} disponíveis`));
    // legenda
    const leg = await page.$$eval("#e-legend li", (ls) => ls.map((l) => [l.dataset.status, l.querySelector("b").textContent]));
    assert.deepEqual(leg, [["disponivel", String(n.disponivel)], ["reservada", String(n.reservada)], ["vendida", String(n.vendida)]]);
    // canvas com tamanho
    const box = await page.locator("#e-canvas").boundingBox();
    assert.ok(box && box.width > 100 && box.height > 100);
  });
});

test("navegador: clicar numa célula seleciona (ARIA, ficha, MiranteEspelho.selected, endereço)", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await cel(page, 1302).click();
    await ocioso(page);
    assert.equal((await estado(page)).selected, 1302);
    assert.deepEqual(await pressionadas(page), [1302]);
    assert.equal(await cel(page, 1302).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#e-ficha-corpo").isVisible(), true);
    assert.equal(await page.locator("#e-ficha-vazia").isHidden(), true);
    assert.equal(await page.locator("#e-f-num").innerText(), "Apartamento 1302");
    assert.equal(await page.locator("#e-f-tipo").innerText(), "Três suítes");
    assert.match(await page.locator("#e-f-area").innerText(), /124/);
    assert.match(await page.locator("#e-f-andar").innerText(), /13/);
    assert.match(await page.locator("#e-f-varanda").innerText(), /sul/i);
    assert.match(await page.title(), /1302/);
    assert.equal(new URL(page.url()).searchParams.get("unidade"), "1302");
    assert.match(await page.locator("#e-resumo").innerText(), /1302/);
    assert.match((await page.locator("#e-f-tour").getAttribute("href")), /^tour\.html\?planta=tres-suites$/);
    assert.match((await page.locator("#e-f-visita").getAttribute("href")), /^index\.html\?planta=tres-suites#visita$/);
    // outra célula: a anterior solta, só uma fica marcada
    await cel(page, 201).click();
    await ocioso(page);
    assert.deepEqual(await pressionadas(page), [201]);
    assert.equal((await estado(page)).selected, 201);
    assert.equal(await page.locator("#e-f-tipo").innerText(), "Studio");
    assert.equal(new URL(page.url()).searchParams.get("unidade"), "201");
    assert.match((await page.locator("#e-f-tour").getAttribute("href")), /planta=studio$/);
  });
});

test("navegador: clicar no modelo (screenPoint) seleciona a mesma unidade na grade", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const casos = [[1301, "fachada"], [802, "fachada"], [203, "fachada"], [1202, "fachada"], [1302, "fundos"], [1204, "fundos"], [205, "fundos"]];
    for (const [id, vista] of casos) {
      await page.click(`#e-views button[data-view="${vista}"]`);
      await ocioso(page);
      await clicarNoModelo(page, id);
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.selected, id, `clique no modelo em ${id} (vista ${vista}) selecionou ${e.selected}`);
      assert.deepEqual(await pressionadas(page), [id], `grade depois do clique em ${id}`);
      assert.equal(await page.locator("#e-f-num").innerText(), `Apartamento ${id}`);
      assert.equal(new URL(page.url()).searchParams.get("unidade"), String(id));
    }
    // clique fora da torre solta a seleção
    const cv = await page.locator("#e-canvas").boundingBox();
    const alvo = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id; }, [cv.x + 8, cv.y + cv.height / 2]);
    assert.equal(alvo, "e-canvas", "o ponto do clique devia cair no canvas");
    await page.mouse.click(cv.x + 8, cv.y + cv.height / 2);
    await ocioso(page);
    assert.equal((await estado(page)).selected, null, "clique fora da torre devia soltar a seleção");
    assert.deepEqual(await pressionadas(page), []);
    assert.equal(new URL(page.url()).searchParams.has("unidade"), false);
  });
});

test("navegador: arrastar o modelo gira a câmera e não seleciona", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const p = await page.evaluate((i) => window.MiranteEspelho.screenPoint(i), 802);
    assert.ok(p.visible);
    const antes = (await estado(page)).camera.position;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 30, p.y + 5, { steps: 4 });
    await page.mouse.move(p.x + 120, p.y + 10, { steps: 8 });
    await page.mouse.up();
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.selected, null, "arrastar não pode selecionar");
    assert.deepEqual(await pressionadas(page), []);
    assert.equal(new URL(page.url()).searchParams.has("unidade"), false);
    assert.ok(dist3(antes, e.camera.position) > 0.5, "a câmera devia ter girado");
    assert.equal(e.view, null, "mexer na câmera tira a vista pronta");
    // depois do arrasto um clique simples ainda funciona
    await page.click('#e-views button[data-view="fachada"]');
    await ocioso(page);
    await clicarNoModelo(page, 802);
    await ocioso(page);
    assert.equal((await estado(page)).selected, 802);
  });
});

test("navegador: unidade vendida não oferece 'Agendar visita'; disponível e reservada oferecem", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    assert.ok(vendida && reservada && disponivel);
    await cel(page, vendida.id).click();
    assert.equal(await page.locator("#e-f-visita").isHidden(), true, `unidade vendida ${vendida.id} mostra 'Agendar visita'`);
    assert.equal(await page.locator("#e-f-tour").isVisible(), true, "o tour continua disponível");
    assert.match(await page.locator("#e-f-status").innerText(), /Vendida/);
    assert.match(await page.locator("#e-f-nota").innerText(), /vendida/i);
    for (const u of [reservada, disponivel]) {
      await cel(page, u.id).click();
      assert.equal(await page.locator("#e-f-visita").isVisible(), true, `unidade ${u.id} (${u.status}) sem 'Agendar visita'`);
      assert.equal(await page.locator("#e-f-visita").getAttribute("href"), `index.html?planta=${u.plan}#visita`);
      assert.equal(await page.locator("#e-f-tour").getAttribute("href"), `tour.html?planta=${u.plan}`);
    }
    // voltar a uma vendida esconde de novo (o estado não vaza entre unidades)
    await cel(page, vendida.id).click();
    assert.equal(await page.locator("#e-f-visita").isHidden(), true);
    // todas as vendidas, no endereço
    for (const u of tower.units.filter((x) => x.status === "vendida")) {
      await page.evaluate((id) => document.querySelector(`#e-grid button[data-unit="${id}"]`).click(), u.id);
      assert.equal(await page.locator("#e-f-visita").isHidden(), true, `vendida ${u.id}`);
    }
  });
});

test("navegador: os links da ficha levam à planta certa em todas as tipologias", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    for (const p of plans) {
      const u = tower.units.find((x) => x.plan === p.id && x.status !== "vendida");
      await cel(page, u.id).click();
      assert.equal(await page.locator("#e-f-tour").getAttribute("href"), `tour.html?planta=${p.id}`);
      assert.equal(await page.locator("#e-f-visita").getAttribute("href"), `index.html?planta=${p.id}#visita`);
    }
  });
});

test("navegador: disponibilidade liga e desliga; o filtro por tipologia muda estado, legenda e grade", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    assert.equal(await page.getAttribute("#e-avail", "aria-pressed"), "true");
    await page.click("#e-avail");
    assert.equal(await page.getAttribute("#e-avail", "aria-pressed"), "false");
    assert.equal((await estado(page)).availability, false);
    assert.equal(await page.locator("#e-panel").evaluate((e) => e.classList.contains("is-avail")), false);
    await page.click("#e-avail");
    assert.equal(await page.getAttribute("#e-avail", "aria-pressed"), "true");
    assert.equal((await estado(page)).availability, true);

    await page.selectOption("#e-tipo", "studio");
    let e = await estado(page);
    assert.equal(e.filter, "studio");
    assert.equal(new URL(page.url()).searchParams.get("planta"), "studio");
    const n = countUnits(tower, "studio");
    const leg = await page.$$eval("#e-legend li b", (bs) => bs.map((b) => Number(b.textContent)));
    assert.deepEqual(leg, [n.disponivel, n.reservada, n.vendida]);
    assert.match(await page.locator("#e-resumo").innerText(), new RegExp(`Studio: ${n.total} unidades, ${n.disponivel} disponíveis`));
    const esmaecidas = await page.$$eval("#e-grid .mirror__row", (rs) => rs.filter((r) => r.classList.contains("is-dim")).map((r) => r.dataset.plan));
    assert.ok(esmaecidas.length > 0 && esmaecidas.every((p) => p !== "studio"), `linhas esmaecidas: ${esmaecidas}`);
    assert.equal(await page.$$eval('#e-grid .mirror__row[data-plan="studio"].is-dim', (r) => r.length), 0);
    // os botões continuam todos presentes
    assert.equal(await page.locator("#e-grid button[data-unit]").count(), 62);

    await page.selectOption("#e-tipo", "tres-suites");
    e = await estado(page);
    assert.equal(e.filter, "tres-suites");
    const n3 = countUnits(tower, "tres-suites");
    assert.equal(await page.$$eval("#e-legend li b", (bs) => bs.reduce((s, b) => s + Number(b.textContent), 0)), n3.total);

    await page.selectOption("#e-tipo", "");
    e = await estado(page);
    assert.equal(e.filter, "");
    assert.equal(new URL(page.url()).searchParams.has("planta"), false);
    assert.equal(await page.$$eval("#e-grid .is-dim", (r) => r.length), 0);
    assert.equal(await page.$$eval("#e-legend li b", (bs) => bs.reduce((s, b) => s + Number(b.textContent), 0)), 62);
  });
});

test("navegador: ?planta=<id> abre com a tipologia em destaque; ?planta inválido é ignorado", { timeout: 90000 }, async (t) => {
  await comPagina(t, "?planta=dois-quartos", {}, async ({ page }) => {
    assert.equal((await estado(page)).filter, "dois-quartos");
    assert.equal(await page.inputValue("#e-tipo"), "dois-quartos");
  });
  await comPagina(t, "?planta=cobertura", {}, async ({ page }) => {
    assert.equal((await estado(page)).filter, "");
  });
});

test("navegador: ?unidade=<id> abre com a unidade escolhida", { timeout: 90000 }, async (t) => {
  await comPagina(t, "?unidade=1302", {}, async ({ page }) => {
    assert.equal((await estado(page)).selected, 1302);
    assert.deepEqual(await pressionadas(page), [1302]);
    assert.equal(await page.locator("#e-f-num").innerText(), "Apartamento 1302");
  });
});

test("navegador: ?unidade= inválido não quebra (nenhuma seleção, sem erro)", { timeout: 120000 }, async (t) => {
  for (const q of ["?unidade=99999", "?unidade=abc", "?unidade=", "?unidade=1302.5", "?unidade=-1", "?unidade=0", "?unidade=101", "?unidade=%E0%A4%A", "?unidade=1302&unidade=x", "?unidade=1e3"]) {
    await comPagina(t, q, {}, async ({ page }) => {
      const e = await estado(page);
      const esperado = q === "?unidade=1302&unidade=x" ? 1302 : null;
      assert.equal(e.selected, esperado, `${q}: selected = ${e.selected}`);
      assert.equal(await page.locator("#e-grid button[data-unit]").count(), 62, q);
      assert.equal(await page.locator("#e-ficha-corpo").isHidden(), esperado === null, q);
    });
  }
});

test("navegador: as vistas prontas (Fachada, Fundos, Aérea) movem a câmera e marcam o botão", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const pose = {};
    for (const v of ["fachada", "fundos", "aerea"]) {
      await page.click(`#e-views button[data-view="${v}"]`);
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.view, v);
      const marcados = await page.$$eval("#e-views button", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.view));
      assert.deepEqual(marcados, [v]);
      const [px, py, pz] = e.camera.position, [tx, ty, tz] = e.camera.target;
      pose[v] = { px, py, pz, tx, ty, tz, horiz: Math.hypot(px - tx, pz - tz), alt: py - ty };
    }
    const meio = tower.slab.d / 2;
    assert.ok(pose.fachada.pz < 0, `fachada: câmera deveria estar diante da frente (z < 0), está em ${pose.fachada.pz}`);
    assert.ok(pose.fundos.pz > tower.slab.d, `fundos: câmera deveria estar atrás da torre (z > 20), está em ${pose.fundos.pz}`);
    assert.ok(pose.fachada.pz < meio && pose.fundos.pz > meio);
    const elev = (p) => Math.atan2(p.alt, p.horiz) * 180 / Math.PI;
    assert.ok(elev(pose.aerea) > elev(pose.fachada) + 20, `aérea precisa olhar bem mais de cima: ${elev(pose.aerea)}° x ${elev(pose.fachada)}°`);
    assert.ok(elev(pose.aerea) > 30);
    // as duas vistas de frente miram o mesmo ponto
    assert.ok(Math.abs(pose.fachada.tx - pose.fundos.tx) < 1e-6 && Math.abs(pose.fachada.ty - pose.fundos.ty) < 1e-6);
  });
});

test("navegador: escolher uma unidade tira a vista pronta; escolher a vista de novo mantém a seleção", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await cel(page, 1001).click();
    await ocioso(page);
    assert.equal((await estado(page)).view, null);
    assert.equal(await page.$$eval("#e-views button", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").length), 0);
    await page.click('#e-views button[data-view="aerea"]');
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.view, "aerea");
    assert.equal(e.selected, 1001, "trocar de vista não solta a unidade");
  });
});

test("navegador: mudar hora e mês atualiza a ficha (horas de sol e 'agora')", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const frente = byId(1301), fundos = byId(1302);
    const sol = (u, mes) => {
      const h = unitSunHours(tower, u, mes);
      return h > 0 ? `${formatHour(h)} de sol direto em ${MONTHS[mes - 1]}` : `Sem sol direto em ${MONTHS[mes - 1]}`;
    };
    const agora = (u, mes, hora) => {
      const s = sunPosition({ month: mes, hour: hora });
      const h = formatHour(hora);
      return unitSunlit(tower, u, s) ? `Sol direto na fachada às ${h}` : s.elevation > 0 ? `Fachada na sombra às ${h}` : `Sol abaixo do horizonte às ${h}`;
    };
    const confere = async (u, mes, hora) => {
      assert.equal(await page.locator("#e-f-sol").innerText(), sol(u, mes), `sol de ${u.id} em ${MONTHS[mes - 1]}`);
      assert.equal(await page.locator("#e-f-agora").innerText(), agora(u, mes, hora), `agora de ${u.id}, mês ${mes}, ${hora}h`);
    };
    await cel(page, frente.id).click();
    await confere(frente, 6, 10);

    await page.locator("#e-hour").fill("12");
    assert.equal(await page.locator("#e-hour").inputValue(), "12");
    assert.match(await page.locator("#e-hour-out").innerText(), /12h00/);
    assert.match(await page.getAttribute("#e-hour", "aria-valuetext"), /^12h00/);
    await confere(frente, 6, 12);
    assert.equal(await page.locator("#e-f-agora").innerText(), "Sol direto na fachada às 12h00", "norte ao meio-dia de junho");

    await page.locator("#e-hour").fill("5");
    await confere(frente, 6, 5);
    assert.match(await page.locator("#e-sun-out").innerText(), /abaixo do horizonte/);

    await page.locator("#e-hour").fill("15.5");
    assert.match(await page.locator("#e-hour-out").innerText(), /15h30/);
    await confere(frente, 6, 15.5);

    for (const mes of [12, 3, 1]) {
      await page.selectOption("#e-month", String(mes));
      await confere(frente, mes, 15.5);
    }
    // fachada sul: sem sol direto em junho, com sol no verão
    await page.selectOption("#e-month", "6");
    await cel(page, fundos.id).click();
    await confere(fundos, 6, 15.5);
    assert.equal(await page.locator("#e-f-sol").innerText(), "Sem sol direto em junho");
    await page.selectOption("#e-month", "12");
    await confere(fundos, 12, 15.5);
    assert.match(await page.locator("#e-f-sol").innerText(), /de sol direto em dezembro/);
    // a hora e o mês continuam valendo ao trocar de unidade
    await cel(page, frente.id).click();
    await confere(frente, 12, 15.5);
  });
});

test("navegador: sem movimento reduzido, a câmera voa até a unidade e termina quando MiranteEspelho.busy fica false", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    const antes = (await estado(page)).camera;
    await page.evaluate(() => document.querySelector('#e-grid button[data-unit="1202"]').click());
    assert.equal((await estado(page)).busy, true, "devia haver voo de câmera em curso logo após o clique");
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.busy, false);
    assert.equal(e.selected, 1202);
    assert.ok(dist3(e.camera.target, sceneCenter(1202)) < 3, `alvo da câmera ${e.camera.target} longe da unidade ${sceneCenter(1202)}`);
    assert.ok(dist3(antes.position, e.camera.position) > 5, "a câmera devia ter saído do lugar");
    const dAntes = dist3(antes.position, sceneCenter(1202)), dDepois = dist3(e.camera.position, sceneCenter(1202));
    assert.ok(dDepois < dAntes, "a câmera devia ter chegado mais perto da unidade");
  });
});

test("navegador: dois cliques seguidos em unidades diferentes durante o voo terminam na última", { timeout: 180000 }, async (t) => {
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    const clicaCelula = (id) => page.evaluate((i) => document.querySelector(`#e-grid button[data-unit="${i}"]`).click(), id);
    const confere = async (id, outro) => {
      await ocioso(page);
      const e = await estado(page);
      assert.equal(e.selected, id, `terminou em ${e.selected}, esperado ${id}`);
      assert.deepEqual(await pressionadas(page), [id], "só a última pode estar marcada");
      assert.equal(await page.locator("#e-f-num").innerText(), `Apartamento ${id}`);
      assert.equal(new URL(page.url()).searchParams.get("unidade"), String(id));
      assert.equal(e.view, null);
      assert.equal(e.busy, false);
      assert.ok(dist3(e.camera.target, sceneCenter(id)) < 3, `a câmera terminou mirando ${e.camera.target}, longe de ${id} (${sceneCenter(id)})`);
      assert.ok(dist3(e.camera.target, sceneCenter(id)) < dist3(e.camera.target, sceneCenter(outro)), `a câmera ficou mais perto de ${outro} que de ${id}`);
    };

    // 1) grade, grade: A está voando quando B é clicada
    await clicaCelula(201);
    await doisQuadros(page);
    assert.equal((await estado(page)).busy, true, "o primeiro voo já tinha de estar em curso");
    await clicaCelula(1602);
    await confere(1602, 201);

    // 2) o inverso: volta para a primeira
    await clicaCelula(201);
    await doisQuadros(page);
    await clicaCelula(1602);
    await doisQuadros(page);
    await clicaCelula(1301);         // três seguidas
    await confere(1301, 201);

    // 3) clique no modelo e, durante o voo, clique numa célula
    await page.click('#e-views button[data-view="fachada"]');
    await ocioso(page);
    await clicarNoModelo(page, 802);
    assert.equal((await estado(page)).selected, 802);
    await doisQuadros(page);
    assert.equal((await estado(page)).busy, true, "o voo para 802 já tinha de estar em curso");
    await clicaCelula(1204);
    await confere(1204, 802);

    // 4) clique numa célula e, durante o voo, o mesmo botão de novo solta; clicar de novo seleciona
    await clicaCelula(201);
    await doisQuadros(page);
    await clicaCelula(201);
    await ocioso(page);
    assert.equal((await estado(page)).selected, null);
    assert.deepEqual(await pressionadas(page), []);
    assert.equal(await page.locator("#e-ficha-corpo").isHidden(), true);
  });
});

test("navegador: vista pronta clicada durante o voo para uma unidade termina na vista", { timeout: 120000 }, async (t) => {
  await comPagina(t, "", { reduzido: false }, async ({ page }) => {
    await page.evaluate(() => document.querySelector('#e-grid button[data-unit="1602"]').click());
    await doisQuadros(page);
    assert.equal((await estado(page)).busy, true);
    await page.click('#e-views button[data-view="fundos"]');
    await ocioso(page);
    const e = await estado(page);
    assert.equal(e.view, "fundos");
    assert.ok(e.camera.position[2] > tower.slab.d, `a câmera devia estar atrás da torre, está em z = ${e.camera.position[2]}`);
    assert.ok(Math.abs(e.camera.target[1] - sceneCenter(1602)[1]) > 10, "o alvo devia ter voltado ao centro da torre, não à unidade");
  });
});

test("navegador: Escape solta a seleção e a ficha volta ao estado vazio", { timeout: 90000 }, async (t) => {
  await comPagina(t, "?unidade=1301", {}, async ({ page }) => {
    assert.equal((await estado(page)).selected, 1301);
    await page.locator("#e-canvas").focus();
    await page.keyboard.press("Escape");
    await ocioso(page);
    assert.equal((await estado(page)).selected, null);
    assert.deepEqual(await pressionadas(page), []);
    assert.equal(await page.locator("#e-ficha-vazia").isVisible(), true);
    assert.equal(new URL(page.url()).searchParams.has("unidade"), false);
    assert.doesNotMatch(await page.title(), /1301/);
  });
});

test("navegador: setas entre as células da grade andam sem selecionar", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    const primeiro = page.locator("#e-grid button[data-unit]").first();
    await primeiro.focus();
    const id0 = Number(await primeiro.getAttribute("data-unit"));
    await page.keyboard.press("ArrowRight");
    const id1 = await page.evaluate(() => Number(document.activeElement.dataset.unit));
    assert.notEqual(id1, id0, "ArrowRight devia mover o foco");
    await page.keyboard.press("ArrowDown");
    const id2 = await page.evaluate(() => Number(document.activeElement.dataset.unit));
    assert.ok(Math.floor(id2 / 100) < Math.floor(id1 / 100), "ArrowDown vai para o andar de baixo (número menor)");
    assert.equal((await estado(page)).selected, null);
    assert.equal(await page.locator('#e-grid button[tabindex="0"]').count(), 1, "um só ponto de parada do Tab");
  });
});

test("navegador: a unidade do endereço volta a abrir selecionada depois de recarregar", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", {}, async ({ page }) => {
    await cel(page, 903).click();
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.body.classList.contains("is-ready"), null, { timeout: 20000 });
    await ocioso(page);
    assert.equal((await estado(page)).selected, 903);
    assert.deepEqual(await pressionadas(page), [903]);
  });
});

test("navegador: tela de celular abre sem erro, com a gaveta e os 62 botões", { timeout: 90000 }, async (t) => {
  await comPagina(t, "", { viewport: { width: 390, height: 780 } }, async ({ page }) => {
    assert.equal(await page.locator("#e-grid button[data-unit]").count(), 62);
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "false");
    await page.click("#e-drawer");
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "true");
    await page.click("#e-drawer");
    assert.equal(await page.getAttribute("#e-drawer", "aria-expanded"), "false");
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(sobra <= 1, `rolagem horizontal na página: ${sobra}px`);
  });
});
