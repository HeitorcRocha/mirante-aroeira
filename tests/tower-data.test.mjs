import { test } from "node:test";
import assert from "node:assert/strict";
import { tower, STATUSES } from "../data/tower.js";
import { plans } from "../data/plans.js";
import { checkTower, countUnits, planBalcony, FACADES } from "../tour/tower.js";

const clone = () => structuredClone(tower);
const planOf = (id) => plans.find((p) => p.id === id);
const bandOf = (floor) => tower.bands.find((b) => floor >= b.from && floor <= b.to);

test("torre: 16 andares, 62 unidades, ids únicos inteiros", () => {
  assert.equal(tower.floors, 16);
  assert.equal(tower.units.length, 62);
  const ids = tower.units.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos");
  for (const id of ids) assert.ok(Number.isInteger(id), `id não inteiro: ${id}`);
});

test("torre: o id é andar + final de dois dígitos", () => {
  for (const u of tower.units) {
    assert.equal(Math.floor(u.id / 100), u.floor, `unidade ${u.id}: andar ${u.floor}`);
    const final = u.id % 100;
    assert.ok(final >= 1 && final <= 6, `unidade ${u.id}: final ${final}`);
  }
});

test("torre: nenhum apartamento no térreo nem fora de 2 a 16", () => {
  for (const u of tower.units) assert.ok(u.floor >= 2 && u.floor <= 16, `unidade ${u.id} no andar ${u.floor}`);
  assert.equal(tower.units.filter((u) => u.floor === 1).length, 0);
});

test("torre: tipologia compatível com o andar (studio 2-6, dois-quartos 7-12, três suítes 13-16)", () => {
  const esperado = (f) => (f <= 6 ? "studio" : f <= 12 ? "dois-quartos" : "tres-suites");
  for (const u of tower.units) assert.equal(u.plan, esperado(u.floor), `unidade ${u.id}`);
  for (const u of tower.units) assert.equal(bandOf(u.floor).plan, u.plan);
  for (let f = 2; f <= 16; f++) assert.ok(tower.units.some((u) => u.floor === f), `andar ${f} vazio`);
});

test("torre: unidades por andar (6, 4 e 2) e por tipologia (30, 24 e 8)", () => {
  const porAndar = (f) => tower.units.filter((u) => u.floor === f).length;
  for (let f = 2; f <= 6; f++) assert.equal(porAndar(f), 6, `andar ${f}`);
  for (let f = 7; f <= 12; f++) assert.equal(porAndar(f), 4, `andar ${f}`);
  for (let f = 13; f <= 16; f++) assert.equal(porAndar(f), 2, `andar ${f}`);
  const n = countUnits(tower);
  assert.deepEqual(
    Object.fromEntries(Object.entries(n.byPlan).map(([k, v]) => [k, v.total])),
    { "studio": 30, "dois-quartos": 24, "tres-suites": 8 },
  );
});

test("torre: contagem por status anunciada (43 disponíveis, 7 reservadas, 12 vendidas)", () => {
  for (const u of tower.units) assert.ok(STATUSES.includes(u.status), `unidade ${u.id}: status ${u.status}`);
  const n = countUnits(tower);
  assert.equal(n.total, 62);
  assert.equal(n.disponivel, 43);
  assert.equal(n.reservada, 7);
  assert.equal(n.vendida, 12);
  assert.equal(n.disponivel + n.reservada + n.vendida, n.total);
});

test("countUnits(tower, plano) filtra e a soma das tipologias fecha com o total", () => {
  const soma = { disponivel: 0, reservada: 0, vendida: 0, total: 0 };
  for (const p of plans) {
    const n = countUnits(tower, p.id);
    assert.equal(n.total, tower.units.filter((u) => u.plan === p.id).length);
    assert.equal(n.disponivel + n.reservada + n.vendida, n.total);
    for (const k of Object.keys(soma)) soma[k] += n[k];
  }
  const all = countUnits(tower);
  for (const k of Object.keys(soma)) assert.equal(soma[k], all[k], k);
});

test("countUnits: tipologia que não existe devolve zeros; torre vazia não quebra", () => {
  const n = countUnits(tower, "cobertura");
  assert.equal(n.total, 0);
  const vazio = countUnits({ ...tower, units: [] });
  assert.equal(vazio.total, 0);
  assert.equal(vazio.disponivel, 0);
});

test("laje: 18 x 20 m e toda unidade cabe nela", () => {
  assert.deepEqual([tower.slab.w, tower.slab.d], [18, 20]);
  for (const u of tower.units) {
    assert.ok(u.x >= 0 && u.y >= 0, `unidade ${u.id} com canto negativo`);
    assert.ok(u.x + u.w <= 18 + 1e-9 && u.y + u.d <= 20 + 1e-9, `unidade ${u.id} sai da laje`);
  }
});

test("laje: nenhuma unidade sobrepõe outra do mesmo andar nem o núcleo", () => {
  const c = tower.core;
  const cruza = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.d - 1e-9 && b.y < a.y + a.d - 1e-9;
  for (let f = 2; f <= 16; f++) {
    const l = tower.units.filter((u) => u.floor === f);
    for (let i = 0; i < l.length; i++) {
      assert.ok(!cruza(l[i], { x: c.x, y: c.y, w: c.w, d: c.d }), `${l[i].id} sobrepõe o núcleo`);
      for (let j = i + 1; j < l.length; j++) assert.ok(!cruza(l[i], l[j]), `${l[i].id} e ${l[j].id} se sobrepõem`);
    }
  }
});

test("unidade: testada e profundidade batem com w/h da planta em data/plans.js", () => {
  for (const u of tower.units) {
    const p = planOf(u.plan);
    assert.ok(p, `planta ${u.plan}`);
    const b = planBalcony(p);
    const lateral = u.facade === "direita" || u.facade === "esquerda";
    const testada = lateral ? u.d : u.w, prof = lateral ? u.w : u.d;
    assert.ok(Math.abs(testada - b.frontage) < 1e-6, `${u.id}: testada ${testada} x ${b.frontage}`);
    assert.ok(Math.abs(prof - b.unitDepth) < 1e-6, `${u.id}: profundidade ${prof} x ${b.unitDepth}`);
    assert.deepEqual([testada, prof].sort((a, b2) => a - b2), [p.w, p.h].sort((a, b2) => a - b2));
  }
});

test("unidade: fachada conhecida e encostada na borda da laje", () => {
  for (const u of tower.units) {
    assert.ok(u.facade in FACADES, `${u.id}: fachada ${u.facade}`);
    if (u.facade === "frente") assert.equal(u.y, 0, String(u.id));
    if (u.facade === "fundos") assert.ok(Math.abs(u.y + u.d - 20) < 1e-9, String(u.id));
  }
});

test("checkTower: os dados reais não têm problema", () => {
  assert.deepEqual(checkTower(tower, plans), []);
});

test("checkTower detecta id repetido", () => {
  const t = clone();
  t.units[1].id = t.units[0].id;
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => m.includes(String(t.units[0].id)) && /repetido/.test(m)), out.join("\n"));
});

test("checkTower detecta sobreposição no mesmo andar", () => {
  const t = clone();
  const a = t.units.find((u) => u.id === 201), b = t.units.find((u) => u.id === 202);
  b.x = a.x + 1;
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => /201/.test(m) && /202/.test(m) && /sobrep/.test(m)), out.join("\n"));
});

test("checkTower detecta tipologia em andar errado", () => {
  const t = clone();
  t.units.find((x) => x.id === 1301).plan = "studio";
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => m.includes("1301") && m.includes("studio") && m.includes("tres-suites")), out.join("\n"));
});

test("checkTower detecta unidade fora da laje", () => {
  const t = clone();
  t.units.find((x) => x.id === 1204).x = 15;
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => m.includes("1204") && /laje/.test(m)), out.join("\n"));
});

test("checkTower detecta id que não começa pelo andar e status desconhecido", () => {
  const t = clone();
  t.units[0].id = 999;
  t.units[1].status = "alugada";
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => m.includes("999") && /andar/.test(m)), out.join("\n"));
  assert.ok(out.some((m) => m.includes("alugada")), out.join("\n"));
});

test("checkTower detecta testada incoerente com a planta e planta inexistente", () => {
  const t = clone();
  t.units.find((u) => u.id === 301).w = 6;
  t.units.find((u) => u.id === 302).plan = "penthouse";
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => m.includes("301")), out.join("\n"));
  assert.ok(out.some((m) => m.includes("302") && m.includes("penthouse")), out.join("\n"));
});

test("checkTower detecta andar sem tipologia e apartamento no térreo", () => {
  const t = clone();
  t.bands = t.bands.filter((b) => b.plan !== "tres-suites");
  const out = checkTower(t, plans);
  assert.ok(out.some((m) => /andar 13/.test(m)), out.join("\n"));
  const t2 = clone();
  t2.units[0].floor = 1;
  t2.units[0].id = 101;
  assert.ok(checkTower(t2, plans).some((m) => m.includes("101")));
});
