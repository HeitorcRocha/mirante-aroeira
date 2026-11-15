import { test } from "node:test";
import assert from "node:assert/strict";
import { plans, fmtArea } from "../data/plans.js";
import * as tools from "../tools/plans.mjs";
import { FURNITURE } from "../tour/geometry.js";

const ANUNCIADAS = { studio: 38, "dois-quartos": 72, "tres-suites": 124 };
const EPS = 1e-6;
const ROTS = [undefined, 0, 90, 180, 270];

test("tools/plans.mjs reexporta as mesmas plantas e o mesmo fmtArea de data/plans.js", () => {
  assert.equal(tools.plans, plans);
  assert.equal(tools.fmtArea, fmtArea);
});

test("ids das plantas são únicos e são os três esperados", () => {
  const ids = plans.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids}`);
  assert.deepEqual([...ids].sort(), Object.keys(ANUNCIADAS).sort());
});

for (const p of plans) {
  test(`${p.id}: soma das áreas dos cômodos bate com a anunciada (±0,05 m²)`, () => {
    const total = p.rooms.reduce((s, r) => s + r.r.reduce((a, [, , w, h]) => a + w * h, 0), 0);
    assert.ok(Math.abs(total - ANUNCIADAS[p.id]) <= 0.05, `soma ${total} != ${ANUNCIADAS[p.id]}`);
    assert.equal(p.area, ANUNCIADAS[p.id]);
  });

  test(`${p.id}: campos antigos continuam presentes com o formato esperado`, () => {
    for (const k of ["rooms", "outer", "inner", "glass", "rail", "doors", "fits"]) {
      assert.ok(Array.isArray(p[k]) && p[k].length > 0, `campo ${k} ausente ou vazio`);
    }
    for (const d of p.doors) {
      assert.ok(d.wall === "h" || d.wall === "v", "door.wall");
      assert.ok(d.w > 0 && Array.isArray(d.at) && d.at.length === 2, "door.at/w");
      assert.ok(d.hinge === 0 || d.hinge === 1, "door.hinge");
      assert.ok(d.side === 1 || d.side === -1, "door.side");
    }
  });

  test(`${p.id}: north é um número finito entre 0 e 360`, () => {
    assert.equal(typeof p.north, "number");
    assert.ok(Number.isFinite(p.north) && p.north >= 0 && p.north <= 360, `north=${p.north}`);
  });

  test(`${p.id}: há móveis, todos de tipo conhecido, com tamanho positivo e rot válida`, () => {
    assert.ok(Array.isArray(p.furniture) && p.furniture.length > 0);
    p.furniture.forEach((f, i) => {
      assert.ok(f.type in FURNITURE, `#${i}: tipo desconhecido "${f.type}"`);
      assert.ok(f.w > 0 && f.h > 0, `#${i} ${f.type}: dimensão não positiva`);
      assert.ok([f.x, f.y, f.w, f.h].every(Number.isFinite), `#${i} ${f.type}: número inválido`);
      assert.ok(ROTS.includes(f.rot), `#${i} ${f.type}: rot=${f.rot}`);
    });
  });

  test(`${p.id}: todo móvel cabe inteiro em algum cômodo`, () => {
    p.furniture.forEach((f, i) => {
      const area = f.w * f.h;
      const ok = p.rooms.some((room) => {
        const inside = room.r.reduce((s, [x, y, w, h]) =>
          s + Math.max(0, Math.min(f.x + f.w, x + w) - Math.max(f.x, x)) * Math.max(0, Math.min(f.y + f.h, y + h) - Math.max(f.y, y)), 0);
        return Math.abs(inside - area) < EPS;
      });
      assert.ok(ok, `#${i} ${f.type} (${f.x}, ${f.y}, ${f.w}x${f.h}) não cabe inteiro em nenhum cômodo`);
    });
  });

  test(`${p.id}: a varanda fica do lado do norte da planta`, () => {
    const rad = Math.PI / 180;
    const n = [Math.sin(p.north * rad), -Math.cos(p.north * rad)];
    const varanda = p.rooms.find((r) => /^Varanda/.test(r.name));
    assert.ok(varanda, "sem varanda");
    const [x, y, w, h] = varanda.r[0];
    const dot = (x + w / 2 - p.w / 2) * n[0] + (y + h / 2 - p.h / 2) * n[1];
    assert.ok(dot > 0, `varanda não está do lado norte (produto escalar ${dot.toFixed(2)})`);
  });
}
