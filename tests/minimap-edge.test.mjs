// Casos de borda do mini-mapa, da vista de topo e das luzes da casa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plans } from "../data/plans.js";
import { buildModel, lightSpots, roomAt, DIM } from "../tour/geometry.js";
import { minimapData, minimapSvg, roomOutline, roomFill, viewWedge, topDownHeight, topDownPose } from "../tour/minimap.js";

const tanHalf = (fov) => Math.tan((fov * Math.PI) / 360);

test("topDownHeight: retângulo sem tamanho dá só a altura do topo; tamanho negativo vale como positivo", () => {
  const h = topDownHeight({ x0: 3, y0: 3, x1: 3, y1: 3 }, 40, 1, { top: 2.7 });
  assert.equal(h, 2.7);
  const a = topDownHeight({ x0: 0, y0: 0, x1: 4, y1: 2 }, 40, 1.3, { top: 2.7 });
  const b = topDownHeight({ x0: 4, y0: 2, x1: 0, y1: 0 }, 40, 1.3, { top: 2.7 });
  assert.equal(a, b);
});

test("topDownHeight/topDownPose: NaN, Infinity e campos faltando nunca vazam número inválido", () => {
  const ok = { x0: 0, y0: 0, x1: 3, y1: 3 };
  for (const bad of [NaN, Infinity, -Infinity, undefined, "3", null]) {
    for (const box of [{ ...ok, x1: bad }, { ...ok, y0: bad }]) {
      const h = topDownHeight(box, 40, 1);
      if (bad === null) continue;           // Number.isFinite(null) é false: tem de dar NaN também
      assert.ok(Number.isNaN(h), `box com ${String(bad)} deu ${h}`);
      assert.equal(topDownPose(box, 40, 1), null);
    }
    assert.ok(Number.isNaN(topDownHeight(ok, 40, bad)), `aspect ${String(bad)}`);
    assert.ok(Number.isNaN(topDownHeight(ok, bad, 1)), `fov ${String(bad)}`);
  }
  assert.ok(Number.isNaN(topDownHeight({ ...ok, x1: null }, 40, 1)), "null nunca vira 0 em silêncio");
  assert.ok(Number.isNaN(topDownHeight(ok, 40, 1, { top: NaN })));
});

for (const p of plans) {
  const m = buildModel(p);

  test(`${p.id}: vista de topo cabe no frustum em proporções extremas (0,4 celular em pé; 2,5 ultrawide), de verdade`, () => {
    for (const room of m.rooms) for (const aspect of [0.4, 2.5]) {
      const fov = 40, b = room.bbox;
      const pose = topDownPose(b, fov, aspect, { margin: 1.25, top: DIM.ceiling });
      assert.ok(pose && Number.isFinite(pose.height) && pose.height > DIM.ceiling, `${room.full} @${aspect}`);
      // projeta os 4 cantos do topo das paredes pelo pose real (câmera em pos, olhando para target)
      const dist = pose.height - DIM.ceiling;
      for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
        const ndcX = (x - pose.target[0]) / (dist * tanHalf(fov) * aspect);
        const ndcY = (y - pose.target[2]) / (dist * tanHalf(fov));
        assert.ok(Math.abs(ndcX) < 1 && Math.abs(ndcY) < 1, `${room.full} @${aspect}: canto (${x},${y}) fora da tela (${ndcX.toFixed(2)}, ${ndcY.toFixed(2)})`);
      }
      // o alvo é o centro do ambiente
      assert.ok(Math.abs(pose.target[0] - (b.x0 + b.x1) / 2) < 1e-9 && Math.abs(pose.target[2] - (b.y0 + b.y1) / 2) < 1e-9);
    }
  });

  test(`${p.id}: o centro da vista de topo cai dentro do bbox de cada ambiente`, () => {
    for (const room of m.rooms) {
      const [cx, , cy] = topDownPose(room.bbox, 40, 1.6).target;
      assert.ok(cx > room.bbox.x0 && cx < room.bbox.x1 && cy > room.bbox.y0 && cy < room.bbox.y1);
    }
  });

  test(`${p.id}: mini-mapa sem NaN/undefined nos paths, viewBox positivo e cada ambiente uma vez`, () => {
    const svg = minimapSvg(m);
    assert.ok(!/NaN|undefined|Infinity|null/.test(svg), "texto inválido no SVG");
    const { viewBox, rooms } = minimapData(m);
    assert.ok(viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0);
    assert.deepEqual(rooms.map((r) => r.index), [...new Set(rooms.map((r) => r.index))], "índices repetidos");
    for (const r of rooms) {
      assert.ok(r.fill.length > 0 && r.outline.length > 0, `${r.name}: path vazio`);
      assert.ok(/^(M[-\d. ]+(H|V)[-\d. ]+)+/.test(r.outline), `${r.name}: outline estranho`);
    }
    assert.equal((svg.match(/data-room=/g) || []).length, rooms.length * 2);
  });

  test(`${p.id}: luzes: dentro do ambiente, sem duplicata, w/h positivos e dentro do retângulo`, () => {
    const spots = lightSpots(m);
    const seen = new Set();
    for (const s of spots) {
      assert.ok([s.x, s.y, s.w, s.h].every(Number.isFinite) && s.w > 0 && s.h > 0);
      const k = `${s.x.toFixed(3)},${s.y.toFixed(3)}`;
      assert.ok(!seen.has(k), `luz duplicada em ${k}`);
      seen.add(k);
      assert.equal(roomAt(m, s.x, s.y), s.room);
    }
    // nenhuma luz perto demais de outra (<1,5 m) dentro do mesmo ambiente
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      if (spots[i].room !== spots[j].room) continue;
      assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) > 1.5, `luzes coladas no ambiente ${spots[i].room}`);
    }
  });
}

test("lightSpots: ambiente com um só retângulo pequeno ainda recebe uma luz", () => {
  const model = { rooms: [{ index: 0, rects: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] }] };
  const s = lightSpots(model);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].x, s[0].y], [0.5, 0.5]);
});

test("lightSpots: modelo sem ambientes devolve lista vazia", () => {
  assert.deepEqual(lightSpots({ rooms: [] }), []);
});

test("roomFill/roomOutline/viewWedge: entradas vazias e ângulos extremos não geram NaN", () => {
  assert.equal(roomFill([]), "");
  assert.equal(roomOutline([]), "");
  for (const yaw of [0, -7, 1e6, Math.PI * 2]) assert.ok(!/NaN/.test(viewWedge(1, 2, yaw)), `yaw ${yaw}`);
});
