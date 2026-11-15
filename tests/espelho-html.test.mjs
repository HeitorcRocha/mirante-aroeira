import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile();
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

const html = strip(read("espelho.html"));
const attr = (s, n) => {
  const m = s.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2]) : null;
};
const tags = (name, src) => [...src.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => m[1]);
const local = (u) => u && !/^(data:|https?:|\/\/|#|mailto:)/i.test(u);
const clean = (u) => u.split(/[?#]/)[0];

const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

test("espelho.html: todo arquivo local referenciado (css, js, fontes, imagens, links) existe", () => {
  const refs = [
    ...tags("link", html).map((a) => attr(a, "href")),
    ...tags("script", html).map((a) => attr(a, "src")),
    ...tags("img", html).map((a) => attr(a, "src")),
    ...tags("a", html).map((a) => attr(a, "href")),
  ].filter(local).map(clean).filter(Boolean);
  assert.ok(refs.length >= 5, "esperava ao menos css, js e links");
  for (const r of refs) assert.ok(exists(r), `espelho.html referencia um arquivo que não existe: ${r}`);
});

test("espelho.html: import map aponta three e three/addons/ para vendor/ e vem antes do módulo", () => {
  assert.ok(importMap.three && importMap["three/addons/"], "import map incompleto");
  assert.ok(importMap.three.includes("vendor/") && importMap["three/addons/"].includes("vendor/"));
  assert.ok(exists(importMap.three), `não existe: ${importMap.three}`);
  assert.ok(fs.existsSync(path.join(ROOT, importMap["three/addons/"])), `não existe: ${importMap["three/addons/"]}`);
  assert.ok(importMap["three/addons/"].endsWith("/"), "prefixo precisa terminar em /");
  assert.ok(exists("vendor/three/build/three.core.js"), "three.module.js importa three.core.js");
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
});

test("espelho.html: o script de módulo é tour/espelho.js e os imports relativos dele existem", () => {
  const src = tags("script", html).map((a) => attr(a, "src")).find((s) => s && /espelho\.js$/.test(s));
  assert.equal(src, "tour/espelho.js");
  const js = read("tour/espelho.js");
  const specs = [...js.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) {
    if (/^\.{1,2}\//.test(s)) assert.ok(exists(path.posix.join("tour", s)), `import relativo inexistente: ${s}`);
    else assert.ok(importMap[s] || Object.keys(importMap).some((p) => p.endsWith("/") && s.startsWith(p)), `especificador sem import map: ${s}`);
  }
});

test("espelho.html: ids que o espelho.js usa existem no HTML", () => {
  const js = read("tour/espelho.js");
  const ids = new Set([...js.matchAll(/\$\(\s*["']([\w-]+)["']\s*\)/g)].map((m) => m[1]));
  for (const m of js.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)) ids.add(m[1]);
  assert.ok(ids.size > 10, "não achei os ids em espelho.js (o padrão de busca mudou?)");
  for (const id of ids) assert.match(html, new RegExp(`\\sid="${id}"`), `espelho.js usa #${id}, que não existe em espelho.html`);
});

test("espelho.html: ids são únicos", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
});

test("espelho.html: rede de segurança contra 'Carregando' eterno", () => {
  assert.match(html, /id="e-status"[^>]*>\s*Carregando/);
  const classico = [...html.matchAll(/<script(?![^>]*\b(?:type|src)=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  assert.match(classico, /addEventListener\(\s*["']load["']/);
  assert.match(classico, /setTimeout/);
  assert.match(classico, /is-ready/, "só some se o corpo ganhou is-ready");
  assert.match(classico, /e-fallback/);
  assert.match(classico, /hidden\s*=\s*false/, "precisa mostrar o plano B");
  assert.match(classico, /e-status/, "precisa esconder o 'Carregando'");
  // o fallback começa escondido e tem caminho para as plantas
  assert.match(html, /id="e-fallback"[^>]*\bhidden\b/);
  assert.match(html, /id="e-fallback"[\s\S]*?href="index\.html#plantas"/);
  // espelho.js marca is-ready no fim da montagem
  assert.match(read("tour/espelho.js"), /classList\.add\(\s*["']is-ready["']\s*\)/);
});

test("espelho.html: noscript, idioma e viewport", () => {
  assert.match(html, /<html lang="pt-BR"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<noscript>[\s\S]*?index\.html#plantas/);
});

test("espelho.html: links de ação da ficha apontam para tour.html e index.html#visita", () => {
  assert.match(html, /id="e-f-tour"[^>]*href="tour\.html/);
  assert.match(html, /id="e-f-visita"[^>]*href="index\.html#visita"/);
});

test("espelho.html: botões e controles têm nome acessível", () => {
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const nome = attr(m[1], "aria-label") || m[2].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
    assert.ok(nome, `botão sem nome acessível: ${m[0].slice(0, 80)}`);
  }
  for (const id of ["e-tipo", "e-hour", "e-month"]) {
    assert.match(html, new RegExp(`for="${id}"`), `#${id} sem <label for>`);
  }
});

test("landing (index.html) e tour (tour.html) têm link para espelho.html", () => {
  for (const f of ["index.html", "tour.html"]) {
    const links = tags("a", strip(read(f))).map((a) => attr(a, "href")).filter(Boolean);
    assert.ok(links.some((h) => /^espelho\.html(\?|#|$)/.test(h)), `${f} sem link para espelho.html`);
  }
});

test("index.html: id=\"ficha\" existe (destino de index.html#ficha, usado pelo botão Voltar do espelho)", () => {
  assert.match(strip(read("index.html")), /\sid="ficha"/);
  assert.match(html, /href="index\.html#ficha"/);
});

test("index.html: o formulário de visita tem #visita e as tipologias que o espelho envia em ?planta=", () => {
  const idx = strip(read("index.html"));
  assert.match(idx, /\sid="visita"/);
  const opcoes = [...idx.matchAll(/<select id="f-planta"[\s\S]*?<\/select>/g)][0][0];
  for (const id of ["studio", "dois-quartos", "tres-suites"]) assert.match(opcoes, new RegExp(`value="${id}"`));
});

test("tour.js: o link para o espelho leva a tipologia aberta (?planta=)", () => {
  assert.match(read("tour/tour.js"), /espelho\.html\?planta=/);
});
