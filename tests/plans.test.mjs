import { test } from "node:test";
import assert from "node:assert/strict";
import { plans, build, fmtArea, render } from "../tools/plans.mjs";

const ANUNCIADAS = { studio: 38, "dois-quartos": 72, "tres-suites": 124 };
const EPS = 1e-9;
const rects = (p) => p.rooms.flatMap((room, i) => room.r.map((r) => ({ room: room.full, i, x: r[0], y: r[1], w: r[2], h: r[3] })));

test("existem as três plantas esperadas, com a área anunciada", () => {
  assert.deepEqual(plans.map((p) => p.id), Object.keys(ANUNCIADAS));
  for (const p of plans) assert.equal(p.area, ANUNCIADAS[p.id]);
});

for (const p of plans) {
  test(`${p.id}: soma das áreas dos cômodos bate com a anunciada`, () => {
    const { total } = build(p);
    assert.ok(Math.abs(total - p.area) <= 0.05, `soma ${total} != ${p.area}`);
  });

  test(`${p.id}: nenhum cômodo sai do contorno 0..w, 0..h`, () => {
    for (const r of rects(p)) {
      assert.ok(r.w > 0 && r.h > 0, `${r.room}: dimensão não positiva`);
      assert.ok(r.x >= -EPS && r.y >= -EPS, `${r.room}: começa fora (${r.x}, ${r.y})`);
      assert.ok(r.x + r.w <= p.w + EPS, `${r.room}: passa da largura (${r.x + r.w} > ${p.w})`);
      assert.ok(r.y + r.h <= p.h + EPS, `${r.room}: passa da altura (${r.y + r.h} > ${p.h})`);
    }
  });

  test(`${p.id}: nenhum par de cômodos se sobrepõe`, () => {
    const rs = rects(p);
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
      const A = rs[a], B = rs[b];
      const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
      const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      assert.ok(!(ox > 1e-6 && oy > 1e-6), `"${A.room}" e "${B.room}" se sobrepõem em ${(ox * oy).toFixed(2)} m²`);
    }
  });

  test(`${p.id}: os cômodos preenchem o contorno (sem buracos)`, () => {
    const total = rects(p).reduce((a, r) => a + r.w * r.h, 0);
    assert.ok(Math.abs(total - p.w * p.h) < 0.05, `cômodos ${total.toFixed(2)} vs contorno ${(p.w * p.h).toFixed(2)}`);
  });
}

test("build lança erro quando a soma não bate com a área anunciada", () => {
  const ruim = { ...plans[0], area: plans[0].area + 1 };
  assert.throws(() => build(ruim), /somam .* anuncia/);
});

test("build tolera diferença de até 0,05 m² e rejeita acima disso", () => {
  assert.doesNotThrow(() => build({ ...plans[0], area: plans[0].area + 0.04 }));
  assert.throws(() => build({ ...plans[0], area: plans[0].area + 0.2 }));
});

test("render lança erro se um marcador não existe no HTML", () => {
  assert.throws(() => render("<html></html>"), /marcador/);
});

test("fmtArea: pt-BR, vírgula decimal e sem ',0'", () => {
  assert.equal(fmtArea(38), "38 m²");
  assert.equal(fmtArea(38.0000001), "38 m²");
  assert.equal(fmtArea(7.2), "7,2 m²");
  assert.equal(fmtArea(2.2 * 1.8), "4 m²");
  assert.equal(fmtArea(0.45 * 2), "0,9 m²");
  assert.equal(fmtArea(12.34), "12,3 m²");
  assert.ok(!fmtArea(10).includes(",0"));
  assert.ok(!fmtArea(7.5).includes("."));
});

test("a lista de cômodos mostra áreas formatadas", () => {
  const { list } = build(plans[0]);
  assert.match(list, /Estar, dormir e cozinha<\/span> <span class="unit__m2">\d+(,\d)? m²/);
});
