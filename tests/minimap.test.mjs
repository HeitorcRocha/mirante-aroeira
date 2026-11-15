import { test } from "node:test";
import assert from "node:assert/strict";
import { plans } from "../data/plans.js";
import { buildModel, lightSpots, roomAt, DIM } from "../tour/geometry.js";
import { minimapData, minimapSvg, roomOutline, roomFill, viewWedge, topDownHeight, topDownPose } from "../tour/minimap.js";

const models = new Map(plans.map((p) => [p.id, buildModel(p)]));
const near = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b} ±${tol}, veio ${a}`);
const tanHalf = (fov) => Math.tan((fov * Math.PI) / 360);

/* ----------------------------------------------------------------- mapa -- */

for (const p of plans) {
  const m = models.get(p.id);

  test(`${p.id}: o mini-mapa tem cada ambiente uma vez, com data-room certo e o nome`, () => {
    const svg = minimapSvg(m);
    const fills = [...svg.matchAll(/<path class="minimap__room" data-room="(\d+)"[^>]*><title>([^<]*)<\/title>/g)];
    assert.deepEqual(fills.map((f) => Number(f[1])), m.rooms.map((r) => r.index));
    for (const [, i, name] of fills) {
      const full = m.rooms[Number(i)].full.replace(/&/g, "&amp;");
      assert.equal(name, full);
    }
    const outlines = [...svg.matchAll(/class="minimap__outline" data-room="(\d+)"/g)].map((x) => Number(x[1]));
    assert.deepEqual(outlines, m.rooms.map((r) => r.index), "um contorno por ambiente");
    assert.match(svg, /^<svg\b[^>]*role="img"[^>]*aria-label="Mini-mapa do apartamento [^"]+"/);
    assert.equal((svg.match(/class="minimap__me"/g) || []).length, 1, "um grupo para o marcador");
  });

  test(`${p.id}: o viewBox contém os limites do modelo, com folga`, () => {
    const { viewBox: [x, y, w, h], walls } = minimapData(m);
    const B = m.bounds;
    assert.ok(x < B.x0 && y < B.y0 && x + w > B.x1 && y + h > B.y1, `viewBox ${[x, y, w, h]} vs ${JSON.stringify(B)}`);
    assert.ok(walls.length > 0);
    for (const q of walls) {
      assert.ok(q.x >= x && q.y >= y && q.x + q.w <= x + w && q.y + q.h <= y + h, "parede fora do viewBox");
    }
  });

  test(`${p.id}: o mini-mapa deixa as vergas de fora (vão de porta aparece aberto)`, () => {
    const { walls } = minimapData(m);
    const vergas = m.walls.filter((w) => w.kind === "verga").length;
    const doPiso = m.walls.filter((w) => w.z0 === 0 && w.kind !== "peitoril").length;
    assert.ok(vergas > 0);
    assert.equal(walls.length, doPiso);
  });

  test(`${p.id}: luzes da casa: ao menos uma por ambiente, dentro dele, e menos de 20`, () => {
    const spots = lightSpots(m);
    assert.ok(spots.length < 20, `${spots.length} luzes`);
    for (const room of m.rooms) assert.ok(spots.some((s) => s.room === room.index), `"${room.full}" sem luz`);
    for (const s of spots) assert.equal(roomAt(m, s.x, s.y), s.room, `luz em (${s.x}, ${s.y}) fora do ambiente ${s.room}`);
  });

  test(`${p.id}: vista de topo: cada ambiente cabe na tela, em pé e deitada`, () => {
    for (const room of m.rooms) {
      for (const aspect of [0.5, 0.75, 1, 16 / 9, 2.4]) {
        const fov = 40, h = topDownHeight(room.bbox, fov, aspect, { margin: 1.2, top: DIM.ceiling });
        const reach = (h - DIM.ceiling) * tanHalf(fov);       // meia altura visível no topo das paredes
        const b = room.bbox;
        assert.ok((b.y1 - b.y0) / 2 <= reach + 1e-9, `${room.full} @${aspect}: altura não cabe`);
        assert.ok((b.x1 - b.x0) / 2 <= reach * aspect + 1e-9, `${room.full} @${aspect}: largura não cabe`);
      }
    }
  });
}

test("roomOutline: o L do studio sai sem a emenda entre os dois retângulos", () => {
  const room = models.get("studio").rooms[0];
  assert.equal(room.rects.length, 2);
  const d = roomOutline(room.rects);
  // a emenda é y = 1.8 de x = 2.2 a 6.2; sobra só o trecho de 0 a 2.2
  assert.ok(!/M2\.2 1\.8H6\.2/.test(d), d);
  assert.match(d, /M0 1\.8H2\.2/);
  // um retângulo sozinho: quatro lados
  assert.equal((roomOutline([{ x0: 0, y0: 0, x1: 2, y1: 1 }]).match(/M/g) || []).length, 4);
  assert.equal(roomFill([{ x0: 0, y0: 0, x1: 2, y1: 1 }]), "M0 0H2V1H0Z");
});

test("minimapSvg escapa o texto dos nomes", () => {
  const m = models.get("studio");
  const fake = { ...m, title: 'A "B" <C>', rooms: m.rooms.map((r, i) => (i ? r : { ...r, full: "Sala & <cozinha>" })) };
  const svg = minimapSvg(fake);
  assert.match(svg, /<title>Sala &amp; &lt;cozinha&gt;<\/title>/);
  assert.match(svg, /aria-label="Mini-mapa do apartamento A &quot;B&quot; &lt;C&gt;"/);
});

test("minimapData recusa modelo inválido com erro claro", () => {
  assert.throws(() => minimapData(null), TypeError);
  assert.throws(() => minimapData({}), TypeError);
});

test("viewWedge: a ponta fica no visitante e o arco à frente dele", () => {
  // yaw 0 olha para y negativo
  const d = viewWedge(5, 5, 0, 1, Math.PI / 2);
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.deepEqual(n.slice(0, 2), [5, 5]);
  assert.ok(n[3] < 5 && n[n.length - 1] < 5, `arco atrás do visitante: ${d}`);
  // yaw = pi/2 olha para x negativo
  const e = viewWedge(5, 5, Math.PI / 2, 1, Math.PI / 2).match(/-?\d+(\.\d+)?/g).map(Number);
  assert.ok(e[2] < 5 && e[e.length - 2] < 5, "deveria apontar para x negativo");
});

/* ---------------------------------------------------------- vista de topo -- */

test("topDownHeight cresce com o tamanho do ambiente e com a margem", () => {
  const small = { x0: 0, y0: 0, x1: 2, y1: 2 }, big = { x0: 0, y0: 0, x1: 6, y1: 4 };
  for (const aspect of [0.6, 1.6]) {
    assert.ok(topDownHeight(big, 40, aspect) > topDownHeight(small, 40, aspect));
    assert.ok(topDownHeight(small, 40, aspect, { margin: 1.5 }) > topDownHeight(small, 40, aspect, { margin: 1.1 }));
  }
  // em pé (aspect < 1), um ambiente largo precisa de mais altura que deitado
  assert.ok(topDownHeight(big, 40, 0.6) > topDownHeight(big, 40, 1.6));
  // top soma direto: o retângulo é enquadrado nessa altura
  near(topDownHeight(small, 40, 1, { top: 2.7 }) - topDownHeight(small, 40, 1), 2.7, 1e-9);
  // conta fechada: quadrado 2x2, tela quadrada, sem margem
  near(topDownHeight(small, 40, 1, { margin: 1 }), 1 / tanHalf(40), 1e-9);
});

test("topDownHeight devolve NaN com entrada inválida", () => {
  const b = { x0: 0, y0: 0, x1: 2, y1: 2 };
  for (const args of [[null, 40, 1], [b, 0, 1], [b, 180, 1], [b, 40, 0], [b, 40, -1], [b, NaN, 1], [{ x0: 0 }, 40, 1], [b, 40, 1, { margin: 0 }]]) {
    assert.ok(Number.isNaN(topDownHeight(...args)), JSON.stringify(args));
  }
  assert.equal(topDownPose(null, 40, 1), null);
});

test("topDownPose: câmera acima do centro, quase vertical, deslocada para +y", () => {
  const b = { x0: 1, y0: 2, x1: 5, y1: 4 };
  const pose = topDownPose(b, 40, 1.5, { top: 2.7 });
  assert.deepEqual(pose.target, [3, 0, 3]);
  const [x, y, z] = pose.pos;
  near(x, 3, 1e-12);
  assert.ok(z > 3 && z - 3 < 0.05, "deslocamento mínimo para +y (alto da planta no alto da tela)");
  near(Math.hypot(x - 3, y, z - 3), pose.height, 1e-9);
  assert.ok(y > 2.7);
});
