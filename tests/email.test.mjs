import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../site.js", import.meta.url), "utf8");

// Stubs mínimos para o IIFE rodar sem navegador. Nada do site.js é alterado.
function carregar() {
  const el = () => {
    const e = {
      style: {}, classList: { toggle() {}, contains: () => false }, options: [], selectedIndex: 0, elements: {},
      querySelectorAll: () => [], querySelector: () => e, getAttribute: () => "", setAttribute() {},
      addEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
    };
    return e;
  };
  const ctx = {
    document: { getElementById: () => el(), body: el() },
    matchMedia: () => ({ matches: false }),
    ScrollCraft: { mount() {} },
    requestAnimationFrame() {}, addEventListener() {}, innerHeight: 800, location: {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "site.js" });
  return ctx.window.MiranteAroeira;
}

const { montarEmail } = carregar();
const parse = (url) => {
  const [head, query] = url.split("?");
  const p = new URLSearchParams(query);
  return { head, subject: p.get("subject"), body: p.get("body") };
};

test("site.js expõe montarEmail como função", () => {
  assert.equal(typeof montarEmail, "function");
});

test("começa com mailto: e o destinatário", () => {
  const u = montarEmail("visitas@x.example", "Ana", "Studio, 38 m²", "Sábado");
  assert.ok(u.startsWith("mailto:visitas@x.example?subject="));
  assert.equal(parse(u).head, "mailto:visitas@x.example");
});

test("assunto e corpo decodificados contêm nome, planta e período", () => {
  const { body, subject } = parse(montarEmail("a@b.c", "Ana Souza", "Dois quartos, 72 m²", "Dia de semana, à tarde"));
  assert.match(body, /Nome: Ana Souza\n/);
  assert.match(body, /Planta: Dois quartos, 72 m²\n/);
  assert.match(body, /Melhor período: Dia de semana, à tarde\n/);
  assert.equal(subject, "Visita: Dois quartos, 72 m²");
});

test("o nome é aparado", () => {
  const { body } = parse(montarEmail("a@b.c", "   Ana  \n", "P", "S"));
  assert.match(body, /Nome: Ana\n/);
});

test("&, quebras de linha e acentos não quebram a URL", () => {
  const u = montarEmail("a@b.c", "João & Maria = #1?", "Três suítes", "Sábado\nà tarde");
  const q = u.split("?");
  assert.equal(q.length, 2, "só um '?'");
  assert.equal(q[1].split("&").length, 2, "só subject e body separados por &");
  assert.doesNotMatch(q[1], /[\n\r ]/);
  assert.doesNotMatch(q[1], /[^\x00-\x7F]/);
  assert.ok(!u.includes("#"), "'#' cru quebraria a URL");
  const { body, subject } = parse(u);
  assert.match(body, /Nome: João & Maria = #1\?\n/);
  assert.match(body, /Melhor período: Sábado\nà tarde/);
  assert.equal(subject, "Visita: Três suítes");
});

test("nome só com espaços gera 'Nome:' vazio sem quebrar", () => {
  const { body } = parse(montarEmail("a@b.c", "   ", "P", "S"));
  assert.match(body, /Nome: \nPlanta: P/);
});

test("nome undefined/null não vira a palavra literal 'undefined'/'null'", () => {
  for (const v of [undefined, null]) {
    const { body } = parse(montarEmail("a@b.c", v, "P", "S"));
    assert.doesNotMatch(body, /Nome: (undefined|null)/);
  }
});
