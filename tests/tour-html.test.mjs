import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plans, fmtArea } from "../data/plans.js";
import { render } from "../tools/plans.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile();
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

const tourHtml = read("tour.html");
const tourClean = strip(tourHtml);
const indexHtml = read("index.html");

const attr = (s, n) => {
  const m = s.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2]) : null;
};
const tags = (name, src) => [...src.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => m[1]);
const local = (u) => u && !/^(data:|https?:|\/\/|#|mailto:)/i.test(u);
const clean = (u) => u.split(/[?#]/)[0];

const importMap = JSON.parse(tourClean.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

// resolve um especificador a partir de um arquivo (relativo a ROOT), com o import map
function resolveSpec(spec, fromFile) {
  if (/^\.{1,2}\//.test(spec)) return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  if (importMap[spec]) return path.posix.normalize(importMap[spec]);
  for (const [prefix, target] of Object.entries(importMap)) {
    if (prefix.endsWith("/") && spec.startsWith(prefix)) return path.posix.normalize(target + spec.slice(prefix.length));
  }
  return null;
}
const specs = (src) => [
  ...[...src.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ...[...src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ...[...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
];

test("tour.html: import map aponta three e three/addons/ para arquivos que existem em vendor/", () => {
  assert.ok(importMap.three && importMap["three/addons/"], "import map incompleto");
  assert.ok(importMap.three.includes("vendor/") && importMap["three/addons/"].includes("vendor/"));
  assert.ok(exists(importMap.three), `não existe: ${importMap.three}`);
  assert.ok(fs.existsSync(path.join(ROOT, importMap["three/addons/"])), `não existe: ${importMap["three/addons/"]}`);
  assert.ok(importMap["three/addons/"].endsWith("/"), "prefixo do import map precisa terminar em /");
  assert.ok(exists("vendor/three/build/three.core.js"), "three.module.js importa three.core.js");
});

test("tour.html: o import map vem antes do script de módulo", () => {
  assert.ok(tourClean.indexOf('type="importmap"') < tourClean.indexOf('type="module"'));
});

test("tour.html: todo arquivo local referenciado (css, js, fontes, ícones) existe", () => {
  const refs = [
    ...tags("link", tourClean).map((a) => attr(a, "href")),
    ...tags("script", tourClean).map((a) => attr(a, "src")),
    ...tags("img", tourClean).map((a) => attr(a, "src")),
  ].filter(local);
  assert.ok(refs.length >= 5, `poucas referências: ${refs}`);
  for (const r of refs) {
    const f = clean(r);
    if (/^index\.html$/.test(f)) continue;
    assert.ok(exists(f), `tour.html referencia arquivo inexistente: ${r}`);
  }
  for (const r of ["site.css", "tour.css", "tour/tour.js"]) assert.ok(refs.some((x) => clean(x) === r), `tour.html não referencia ${r}`);
  const fontes = tags("link", tourClean).filter((a) => attr(a, "as") === "font").map((a) => attr(a, "href"));
  assert.ok(fontes.length >= 1);
  for (const f of fontes) assert.ok(exists(clean(f)), `fonte inexistente: ${f}`);
});

test("tour.html: links internos (href para .html) apontam para arquivos que existem", () => {
  for (const a of tags("a", tourClean)) {
    const h = attr(a, "href");
    if (local(h)) assert.ok(exists(clean(h)), `link quebrado: ${h}`);
  }
});

test("tour.css e site.css: todo url() local existe", () => {
  for (const f of ["tour.css", "site.css"]) {
    const css = read(f);
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (!local(m[1])) continue;
      const p = path.posix.normalize(path.posix.join(path.posix.dirname(f), clean(m[1])));
      assert.ok(exists(p), `${f}: url(${m[1]}) inexistente`);
    }
  }
});

test("tour/tour.js: todo id pedido com $(\"...\") existe em tour.html, e ids de tour.html são únicos", () => {
  const ids = tags("[a-z0-9]+", tourClean).map((a) => attr(a, "id")).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos em tour.html`);
  const usados = [...read("tour/tour.js").matchAll(/\$\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  assert.ok(usados.length > 10);
  for (const id of usados) assert.ok(ids.includes(id), `tour.js usa #${id}, que não existe em tour.html`);
});

test("tour.html: o seletor de planta lista exatamente as plantas dos dados, com título e área", () => {
  const sel = tourClean.match(/<select id="t-planta">([\s\S]*?)<\/select>/)[1];
  const opts = [...sel.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(opts.map((o) => o[0]), plans.map((p) => p.id));
  for (const [id, label] of opts) {
    const p = plans.find((q) => q.id === id);
    assert.equal(label.replace(/ /g, " "), `${p.title}, ${fmtArea(p.area)}`);
  }
});

test("módulos JS: todo import (relativo ou via import map) resolve para arquivo existente, a partir de tour/tour.js, incluindo vendor/", () => {
  const visitados = new Set();
  const fila = ["tour/tour.js"];
  while (fila.length) {
    const f = fila.shift();
    if (visitados.has(f)) continue;
    visitados.add(f);
    assert.ok(exists(f), `arquivo importado não existe: ${f}`);
    for (const s of specs(read(f))) {
      const alvo = resolveSpec(s, f);
      assert.ok(alvo, `${f}: especificador "${s}" não resolve (nem relativo, nem no import map)`);
      assert.ok(exists(alvo), `${f}: import "${s}" -> ${alvo} não existe`);
      fila.push(alvo);
    }
  }
  for (const f of ["tour/tour.js", "tour/geometry.js", "tour/sun.js", "data/plans.js", "vendor/three/build/three.module.js", "vendor/three/build/three.core.js", "vendor/three/examples/jsm/controls/OrbitControls.js"]) {
    assert.ok(visitados.has(f), `não visitou ${f}`);
  }
});

test("módulos puros (data/plans.js, tour/geometry.js, tour/sun.js) não importam three nem node:", () => {
  for (const f of ["data/plans.js", "tour/geometry.js", "tour/sun.js"]) {
    for (const s of specs(read(f))) {
      assert.ok(!/^node:|^three/.test(s), `${f} importa "${s}"`);
    }
  }
});

/* ------------------------------------------------------------- index.html -- */

const articles = [...indexHtml.matchAll(/<article\b[^>]*class="[^"]*\bunit\b[^"]*"[^>]*>[\s\S]*?<\/article>/g)]
  .map((m) => ({ text: m[0], start: m.index }));

function markerSpans(id) {
  const spans = [];
  for (const tag of ["plan", "rooms"]) {
    const a = indexHtml.indexOf(`<!--${tag}:${id}-->`), b = indexHtml.indexOf(`<!--/${tag}:${id}-->`);
    assert.ok(a >= 0 && b > a, `marcador ${tag}:${id} ausente`);
    spans.push([a, b + `<!--/${tag}:${id}-->`.length]);
  }
  return spans;
}

test("index.html: uma article.unit por planta, cada uma com link a.unit__tour para tour.html?planta=<id>", () => {
  assert.equal(articles.length, plans.length);
  for (const art of articles) {
    const id = attr(art.text.match(/<article\b([^>]*)>/)[1], "data-unit");
    assert.ok(plans.some((p) => p.id === id), `data-unit "${id}" não existe nos dados`);
    const links = [...art.text.matchAll(/<a\b([^>]*)>/g)].filter((m) => (attr(m[1], "class") || "").split(/\s+/).includes("unit__tour"));
    assert.equal(links.length, 1, `unidade ${id}: esperava 1 link unit__tour, achou ${links.length}`);
    assert.equal(attr(links[0][1], "href"), `tour.html?planta=${id}`);
    const abs = art.start + links[0].index;
    for (const [a, b] of markerSpans(id)) {
      assert.ok(!(abs > a && abs < b), `unidade ${id}: o link está dentro do trecho gerado por tools/plans.mjs e seria apagado`);
    }
    assert.ok(exists("tour.html"));
  }
});

test("index.html: regerar plantas com render() preserva os links do tour", () => {
  const { html } = render(indexHtml);
  for (const p of plans) assert.ok(html.includes(`href="tour.html?planta=${p.id}"`), `link do tour de ${p.id} sumiu após render()`);
  assert.equal(html, indexHtml, "render() deveria ser idempotente sobre o index.html atual");
});

test("index.html: link do tour tem texto visível e aria-label com o nome da planta", () => {
  for (const art of articles) {
    const m = art.text.match(/<a\b([^>]*class="[^"]*unit__tour[^"]*"[^>]*)>([\s\S]*?)<\/a>/);
    assert.ok(m);
    assert.match(m[2].replace(/<[^>]+>/g, "").trim(), /tour 3D/i);
    assert.match(attr(m[1], "aria-label") || "", /tour 3D/i);
  }
});
