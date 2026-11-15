import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const noComments = html.replace(/<!--[\s\S]*?-->/g, "");

const tags = (name, src = noComments) => [...src.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => m[1]);
const attr = (s, n) => {
  const m = s.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2]) : null;
};
const unidades = () => tags("article").filter((a) => (attr(a, "class") || "").split(/\s+/).includes("unit"));

test("exatamente um <h1>", () => {
  assert.equal((noComments.match(/<h1\b/gi) || []).length, 1);
});

test("todo <img> tem alt não vazio, width e height", () => {
  const imgs = tags("img");
  assert.ok(imgs.length >= 8, "esperava várias imagens");
  for (const a of imgs) {
    const src = attr(a, "src");
    assert.ok((attr(a, "alt") || "").trim() !== "", `sem alt: ${src}`);
    assert.match(attr(a, "width") || "", /^\d+$/, `sem width: ${src}`);
    assert.match(attr(a, "height") || "", /^\d+$/, `sem height: ${src}`);
  }
});

test("todo arquivo local referenciado existe em disco", () => {
  const refs = [];
  for (const m of noComments.matchAll(/<[a-z][^>]*>/gi)) {
    const t = m[0];
    for (const n of ["src", "href", "data-sc-src", "data-sc-src-mobile"]) {
      const v = attr(t, n);
      if (v) refs.push(v);
    }
    const ss = attr(t, "srcset");
    if (ss) ss.split(",").forEach((e) => refs.push(e.trim().split(/\s+/)[0]));
  }
  const locais = refs.filter((r) => r && !/^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(r));
  assert.ok(locais.length >= 10, `poucas referências locais encontradas (${locais.length})`);
  for (const r of locais) {
    const file = r.split(/[?#]/)[0];
    assert.ok(fs.existsSync(path.join(ROOT, file)), `arquivo ausente: ${r}`);
  }
});

test("todo <input>/<select> tem id e um <label for> correspondente", () => {
  const labels = new Set(tags("label").map((a) => attr(a, "for")).filter(Boolean));
  const campos = [...tags("input"), ...tags("select")];
  assert.ok(campos.length >= 3);
  for (const a of campos) {
    const id = attr(a, "id");
    assert.ok(id, `campo sem id: ${a}`);
    assert.ok(labels.has(id), `sem <label for="${id}">`);
  }
});

test('o rótulo do CTA é "Agendar visita" em todo .btn', () => {
  const re = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let n = 0;
  for (const m of noComments.matchAll(re)) {
    const cls = (attr(m[2], "class") || "").split(/\s+/);
    if (!cls.includes("btn")) continue;
    n++;
    assert.equal(m[3].replace(/<[^>]+>/g, "").trim(), "Agendar visita");
  }
  assert.ok(n >= 2, `esperava ao menos 2 .btn, achei ${n}`);
});

test("não há travessão (—) em texto visível, alt ou <title>", () => {
  const body = noComments.replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, "");
  assert.ok(!body.replace(/<[^>]+>/g, " ").includes("—"), "travessão no texto");
  for (const a of tags("img", body)) assert.ok(!(attr(a, "alt") || "").includes("—"), "travessão em alt");
  assert.ok(!noComments.match(/<title>([\s\S]*?)<\/title>/i)[1].includes("—"), "travessão no <title>");
});

test("opções de #f-planta batem com os data-unit das três unidades", () => {
  const sel = noComments.match(/<select\b[^>]*id="f-planta"[^>]*>([\s\S]*?)<\/select>/i);
  assert.ok(sel, "select #f-planta ausente");
  const values = [...sel[1].matchAll(/<option\b([^>]*)>/gi)].map((m) => attr(m[1], "value"));
  const units = unidades().map((a) => attr(a, "data-unit"));
  assert.equal(units.length, 3);
  assert.deepEqual(values, units);
});

test("andares das unidades não se sobrepõem e cobrem 2 a 16", () => {
  const faixas = unidades().map((a) => attr(a, "data-floors").split(" ").map(Number));
  assert.equal(faixas.length, 3);
  const vistos = new Set();
  for (const [de, ate] of faixas) {
    assert.ok(de <= ate, `faixa invertida ${de}-${ate}`);
    for (let f = de; f <= ate; f++) {
      assert.ok(!vistos.has(f), `andar ${f} em duas unidades`);
      vistos.add(f);
    }
  }
  for (let f = 2; f <= 16; f++) assert.ok(vistos.has(f), `andar ${f} sem unidade`);
  assert.equal(vistos.size, 15, "há andares fora de 2..16");
});

test("o texto 'andares X a Y' de cada unidade coincide com data-floors", () => {
  const arts = [...noComments.matchAll(/<article\b[^>]*data-floors="(\d+) (\d+)"[\s\S]*?<\/article>/gi)];
  assert.equal(arts.length, 3);
  for (const m of arts) assert.ok(m[0].includes(`andares ${m[1]} a ${m[2]}`), `meta divergente de ${m[1]}-${m[2]}`);
});

test("não há ids duplicados", () => {
  const ids = [...noComments.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "id repetido: " + ids.filter((x, i) => ids.indexOf(x) !== i));
});
