// site.js: index.html?planta=<id>#visita pré-seleciona a tipologia no formulário.
// Carrega o site.js num contexto vm (como email.test.mjs), sem alterá-lo, e
// roda o primeiro quadro do ato das plantas para ver se o scroll sobrescreve.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../site.js", import.meta.url), "utf8");

function carregar(search, { comUnidade = true } = {}) {
  const el = () => {
    const e = {
      style: {}, classList: { toggle() {}, contains: () => false }, options: [], selectedIndex: 0, elements: {},
      querySelectorAll: () => [], querySelector: () => e, getAttribute: () => "", setAttribute() {},
      addEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
    };
    return e;
  };
  const select = el();
  select.options = ["studio", "dois-quartos", "tres-suites"].map((v) => ({ value: v, text: v }));
  select.value = "dois-quartos";                       // o que está no HTML sem JS
  const unidade = el();
  unidade.getAttribute = (n) => (n === "data-floors" ? "2 6" : n === "data-unit" ? "studio" : "");
  unidade.querySelector = () => null;
  const act = el();
  act.querySelectorAll = (sel) => (sel === ".unit" && comUnidade ? [unidade] : []);
  const frames = [];
  const ctx = {
    document: { getElementById: (id) => (id === "f-planta" ? select : id === "plantas" ? act : el()), body: el() },
    matchMedia: () => ({ matches: false }),
    ScrollCraft: { mount() {} },
    requestAnimationFrame: (f) => frames.push(f),
    addEventListener() {}, innerHeight: 800, location: { search },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "site.js" });
  const roda = () => { while (frames.length) frames.shift()(0); };
  return { select, roda };
}

test("?planta=<id> válido escolhe a tipologia no formulário logo ao carregar", () => {
  for (const id of ["studio", "dois-quartos", "tres-suites"]) {
    const { select } = carregar(`?planta=${id}`);
    assert.equal(select.value, id);
  }
});

test("?planta=<id> sobrevive ao primeiro quadro do ato das plantas (o scroll não troca a escolha)", () => {
  const { select, roda } = carregar("?planta=tres-suites");
  roda();
  assert.equal(select.value, "tres-suites");
});

test("sem ?planta o scroll continua escolhendo a planta do ato (comportamento anterior)", () => {
  const { select, roda } = carregar("");
  assert.equal(select.value, "dois-quartos", "antes do primeiro quadro fica o valor do HTML");
  roda();
  assert.equal(select.value, "studio");
});

test("id inválido mantém o comportamento anterior", () => {
  for (const search of ["?planta=cobertura", "?planta=", "?planta=STUDIO", "?planta=studio%20", "?planta=%E0%A4%A", "?planta=__proto__", "?planta=%00"]) {
    const { select, roda } = carregar(search);
    assert.equal(select.value, "dois-quartos", `${search}: não pode mudar ao carregar`);
    roda();
    assert.equal(select.value, "studio", `${search}: o scroll volta a comandar`);
  }
});

test("outros parâmetros não atrapalham e o primeiro ?planta= que casa é usado", () => {
  assert.equal(carregar("?utm_source=x&planta=studio&y=1").select.value, "studio");
  assert.equal(carregar("?unidade=1302&planta=tres-suites").select.value, "tres-suites");
  assert.equal(carregar("?planta=dois%2Dquartos").select.value, "dois-quartos");
});

test("parâmetro com nome parecido não conta (xplanta=, planta2=)", () => {
  const { select } = carregar("?xplanta=studio&planta2=studio");
  assert.equal(select.value, "dois-quartos");
});

test("location sem search (undefined) não quebra o site.js", () => {
  assert.doesNotThrow(() => carregar(undefined));
});
