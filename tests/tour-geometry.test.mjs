import { test } from "node:test";
import assert from "node:assert/strict";
import { plans } from "../data/plans.js";
import {
  DIM, buildModel, checkModel, collides, slideMove, segmentFree, findPath, pathLength, roomAt,
} from "../tour/geometry.js";

const EPS = 1e-9;
const near = (a, b, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b}, veio ${a}`);
const thick = (b) => Math.min(b.x1 - b.x0, b.y1 - b.y0);
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
// o mesmo apartamento sem móveis: isola paredes, vidros e portas
const bare = (p) => buildModel({ ...p, furniture: [] });
// ponto de uma linha perpendicular ao elemento: eixo "x" se a caixa é fina em x
const across = (b, d) => {
  const [cx, cy] = center(b);
  return b.x1 - b.x0 < b.y1 - b.y0 ? [[cx - d, cy], [cx + d, cy]] : [[cx, cy - d], [cx, cy + d]];
};

const models = new Map(plans.map((p) => [p.id, buildModel(p)]));
const bares = new Map(plans.map((p) => [p.id, bare(p)]));

test("constantes de DIM", () => {
  assert.equal(DIM.ceiling, 2.7);
  assert.equal(DIM.outer, 0.15);
  assert.equal(DIM.inner, 0.10);
  assert.equal(DIM.sill, 0.9);
  assert.equal(DIM.head, 2.1);
  assert.equal(DIM.rail, 1.1);
  assert.equal(DIM.radius, 0.25);
});

for (const p of plans) {
  const m = models.get(p.id), b = bares.get(p.id);

  test(`${p.id}: pé-direito 2,70 m e espessuras 0,15 (externa) / 0,10 (interna)`, () => {
    assert.equal(m.height, 2.7);
    const ext = m.walls.filter((w) => w.kind === "externa");
    const int = m.walls.filter((w) => w.kind === "interna");
    assert.ok(ext.length > 0 && int.length > 0);
    for (const w of ext) { near(thick(w), 0.15, 1e-9, "externa"); assert.equal(w.z0, 0); assert.equal(w.z1, 2.7); }
    for (const w of int) { near(thick(w), 0.10, 1e-9, "interna"); assert.equal(w.z0, 0); assert.equal(w.z1, 2.7); }
  });

  test(`${p.id}: todas as peças têm caixa válida (x0<x1, y0<y1, z0<z1) e finita`, () => {
    for (const k of ["walls", "glass", "frames", "rails", "doors", "furniture"]) {
      for (const [i, w] of m[k].entries()) {
        assert.ok([w.x0, w.y0, w.x1, w.y1, w.z0, w.z1].every(Number.isFinite), `${k}[${i}] com NaN`);
        assert.ok(w.x1 > w.x0 && w.y1 > w.y0 && w.z1 > w.z0, `${k}[${i}] (${w.kind || w.type || w.part}) caixa degenerada`);
      }
    }
  });

  test(`${p.id}: checkModel devolve lista vazia`, () => {
    assert.deepEqual(checkModel(m), []);
  });

  test(`${p.id}: ponto de visita de cada cômodo está dentro dele, fora de móveis e livre de colisão`, () => {
    for (const room of m.rooms) {
      const [x, y] = room.visit;
      assert.equal(roomAt(m, x, y), room.index, `"${room.full}": visita (${x},${y}) fora do cômodo`);
      assert.ok(!collides(m.colliders, x, y), `"${room.full}": visita colide`);
      for (const f of m.furniture) {
        if (f.blocks) assert.ok(!(x > f.x0 && x < f.x1 && y > f.y0 && y < f.y1), `"${room.full}": visita dentro de ${f.type}`);
      }
    }
  });

  test(`${p.id}: todo cômodo é alcançável a pé a partir da porta de entrada`, () => {
    const door = m.doors.find((d) => d.entry);
    const [cx, cy] = center(door.gap);
    // um ponto 0,6 m para dentro do apartamento
    const cand = door.wall === "h" ? [[cx, cy - 0.6], [cx, cy + 0.6]] : [[cx - 0.6, cy], [cx + 0.6, cy]];
    const start = cand.find(([x, y]) => roomAt(m, x, y) >= 0);
    assert.ok(start, "sem lado de dentro na porta de entrada");
    for (const room of m.rooms) {
      const path = findPath(m, start, room.visit);
      assert.ok(path && path.length > 0, `sem caminho até "${room.full}"`);
      const last = path[path.length - 1];
      assert.ok(Math.hypot(last[0] - room.visit[0], last[1] - room.visit[1]) < 0.1, `caminho até "${room.full}" termina longe`);
      for (let i = 1; i < path.length; i++) {
        assert.ok(segmentFree(m.colliders, path[i - 1], path[i]), `caminho até "${room.full}" atravessa obstáculo`);
      }
      assert.ok(pathLength(path) >= Math.hypot(last[0] - start[0], last[1] - start[1]) - 1e-6);
    }
  });

  test(`${p.id}: há exatamente uma porta de entrada e ela bloqueia a passagem`, () => {
    const entries = b.doors.filter((d) => d.entry);
    assert.equal(entries.length, 1);
    const [d] = entries;
    assert.ok(collides(b.colliders, ...center(d.gap)), "centro do vão da entrada deveria colidir");
    const [from, to] = across(d.gap, 0.8);
    assert.ok(!segmentFree(b.colliders, from, to), "círculo atravessou a porta de entrada fechada");
    const end = slideMove(b.colliders, from, to);
    assert.ok(Math.hypot(end[0] - to[0], end[1] - to[1]) > 0.3, `slideMove chegou ao outro lado: ${end}`);
  });

  test(`${p.id}: vãos de portas internas são atravessáveis por círculo de raio 0,25`, () => {
    const internas = b.doors.filter((d) => !d.entry);
    assert.ok(internas.length > 0);
    for (const d of internas) {
      const [from, to] = across(d.gap, 0.6);
      assert.ok(!collides(b.colliders, ...from) && !collides(b.colliders, ...to), `extremos da travessia já colidem (porta em ${center(d.gap)})`);
      assert.ok(segmentFree(b.colliders, from, to), `porta interna em (${center(d.gap).map((n) => n.toFixed(2))}) não é atravessável`);
      // a parede ao lado do vão existe (não é um buraco maior que a porta)
      const along = d.wall === "h" ? [d.gap.x0 - 0.1, (d.gap.y0 + d.gap.y1) / 2] : [(d.gap.x0 + d.gap.x1) / 2, d.gap.y0 - 0.1];
      assert.ok(collides(b.colliders, along[0], along[1]), `sem parede ao lado do vão em ${along}`);
    }
  });

  test(`${p.id}: janela: peitoril até 0,90, vidro de 0,90 a 2,10, parede acima; janela bloqueia`, () => {
    const janelas = b.glass.filter((g) => g.kind === "janela");
    for (const g of janelas) {
      assert.equal(g.z0, 0.9);
      assert.equal(g.z1, 2.1);
      // o vidro e o peitoril ocupam o mesmo trecho da parede (x ou y igual)
      const alinhado = (w) => (g.x1 - g.x0 > g.y1 - g.y0)
        ? Math.abs(w.x0 - g.x0) < 1e-9 && Math.abs(w.x1 - g.x1) < 1e-9 && Math.abs(center(w)[1] - center(g)[1]) < 1e-9
        : Math.abs(w.y0 - g.y0) < 1e-9 && Math.abs(w.y1 - g.y1) < 1e-9 && Math.abs(center(w)[0] - center(g)[0]) < 1e-9;
      const sill = b.walls.find((w) => w.kind === "peitoril" && alinhado(w));
      const verga = b.walls.find((w) => w.kind === "verga" && alinhado(w));
      assert.ok(sill, "sem peitoril sob a janela");
      assert.ok(verga, "sem parede acima da janela");
      assert.equal(sill.z0, 0); assert.equal(sill.z1, 0.9);
      assert.equal(verga.z0, 2.1); assert.equal(verga.z1, 2.7);
      const [from, to] = across(g, 0.7);
      assert.ok(collides(b.colliders, ...center(g)), "centro da janela deveria bloquear");
      assert.ok(!segmentFree(b.colliders, from, to), "círculo atravessou a janela");
    }
  });

  test(`${p.id}: pano de vidro da varanda não bloqueia; guarda-corpo (1,10 m) bloqueia`, () => {
    const panos = b.glass.filter((g) => g.kind === "pano");
    assert.ok(panos.length > 0, "sem pano de vidro");
    for (const g of panos) {
      const [from, to] = across(g, 0.7);
      assert.ok(!collides(b.colliders, ...from) && !collides(b.colliders, ...to), "extremos colidem");
      assert.ok(segmentFree(b.colliders, from, to), `pano em (${center(g).map((n) => n.toFixed(2))}) bloqueia a passagem`);
    }
    const corrimaos = b.rails.filter((r) => r.part === "corrimao");
    assert.ok(corrimaos.length > 0);
    for (const r of corrimaos) assert.equal(r.z1, 1.1);
    const guard = b.colliders.filter((c) => c.kind === "guarda-corpo");
    assert.equal(guard.length, p.rail.reduce((s, pts) => s + pts.length - 1, 0));
    for (const c of guard) {
      const [from, to] = across(c, 0.7);
      assert.ok(collides(b.colliders, ...center(c)), "guarda-corpo deveria colidir");
      // a travessia só vale se o lado de dentro for livre
      if (!collides(b.colliders, ...from)) assert.ok(!segmentFree(b.colliders, from, to), "atravessou o guarda-corpo");
    }
  });

  test(`${p.id}: não dá para sair do apartamento atravessando a parede externa (amostrado a cada 10 cm)`, () => {
    let testados = 0;
    for (const pts of p.outer) for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1), n = Math.round(len / 0.1);
      const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
      for (let k = 0; k <= n; k++) {
        const x = x1 + dx * len * (k / n), y = y1 + dy * len * (k / n);
        const nx = -dy, ny = dx;                         // normal ao segmento
        const a = [x + nx * 0.6, y + ny * 0.6], c = [x - nx * 0.6, y - ny * 0.6];
        const [inside, outside] = roomAt(b, ...a) >= 0 ? [a, c] : [c, a];
        if (roomAt(b, ...inside) < 0 || roomAt(b, ...outside) >= 0) continue;   // quina: ambos fora
        if (collides(b.colliders, ...inside)) continue;                          // dentro do raio de outra peça
        testados++;
        assert.ok(!segmentFree(b.colliders, inside, outside), `saída livre pela parede externa em (${x.toFixed(2)}, ${y.toFixed(2)})`);
      }
    }
    assert.ok(testados > 20, `poucos pontos testados: ${testados}`);
  });

  test(`${p.id}: andando em linha reta para fora de qualquer cômodo, nunca se chega fora do apartamento`, () => {
    for (const room of m.rooms) {
      for (let deg = 0; deg < 360; deg += 15) {
        const t = (deg * Math.PI) / 180;
        const to = [room.visit[0] + Math.cos(t) * 30, room.visit[1] + Math.sin(t) * 30];
        const end = slideMove(m.colliders, room.visit, to);
        assert.ok(roomAt(m, end[0], end[1]) >= 0, `saiu do apartamento a partir de "${room.full}" rumo a ${deg}°: ${end.map((n) => n.toFixed(2))}`);
        assert.ok(!collides(m.colliders, end[0], end[1]), "terminou dentro de um obstáculo");
      }
    }
  });

  test(`${p.id}: a malha de navegação só tem células livres dentro de cômodos e fora de colisão`, () => {
    const { nav } = m;
    let livres = 0;
    for (let k = 0; k < nav.free.length; k++) {
      if (!nav.free[k]) continue;
      livres++;
      const x = nav.x0 + ((k % nav.cols) + 0.5) * nav.cell, y = nav.y0 + (Math.floor(k / nav.cols) + 0.5) * nav.cell;
      assert.ok(roomAt(m, x, y) >= 0 && !collides(m.colliders, x, y), `célula livre inválida em (${x},${y})`);
    }
    assert.ok(livres > 1000);
  });
}

/* --------------------------------------------------------- casos de borda -- */

test("planta sem móveis (array vazio e campo ausente): modelo, visita e checkModel funcionam", () => {
  for (const p of plans) {
    const semCampo = { ...p }; delete semCampo.furniture;
    for (const plan of [{ ...p, furniture: [] }, semCampo]) {
      const m = buildModel(plan);
      assert.equal(m.furniture.length, 0);
      assert.deepEqual(checkModel(m), []);
      for (const room of m.rooms) {
        assert.equal(roomAt(m, ...room.visit), room.index);
        assert.ok(!collides(m.colliders, ...room.visit));
      }
    }
  }
});

test("buildModel rejeita tipo de móvel desconhecido e segmento inclinado", () => {
  const p = plans[0];
  assert.throws(() => buildModel({ ...p, furniture: [{ type: "sofa-voador", x: 3, y: 3, w: 1, h: 1 }] }), /desconhecido/);
  assert.throws(() => buildModel({ ...p, inner: [...p.inner, [1, 1, 2, 2]] }), /inclinado/);
});

test("buildModel não altera a planta recebida", () => {
  const p = plans[1];
  const antes = JSON.stringify(p);
  buildModel(p);
  assert.equal(JSON.stringify(p), antes);
});

test("checkModel acusa móvel atravessando parede, fora do cômodo, sobre outro móvel e na frente de porta", () => {
  const p = plans[0];
  const casos = {
    "cruza o pano de vidro e a divisa do cômodo": { type: "sofa", x: 6.0, y: 2.0, w: 0.5, h: 0.8 },
    "parede interna": { type: "armario", x: 2.0, y: 0.2, w: 0.5, h: 1.0 },              // cruza a parede x=2.2
    "fora do apartamento": { type: "mesa", x: 20, y: 20, w: 1, h: 1 },
    "sobre outro móvel": { ...p.furniture.find((f) => f.type === "cama"), x: 4.5, y: 3.1 },
    "frente de porta": { type: "armario", x: 0.3, y: 3.8, w: 0.5, h: 0.5 },
  };
  for (const [nome, f] of Object.entries(casos)) {
    const m = buildModel({ ...p, furniture: [...p.furniture, f] });
    assert.ok(checkModel(m).length > 0, `checkModel não acusou: ${nome}`);
  }
  // controle: o mesmo modelo sem o móvel ruim está limpo
  assert.deepEqual(checkModel(buildModel(p)), []);
});

test("checkModel acusa cômodo inalcançável (porta de entrada trancada por móvel enorme)", () => {
  const p = plans[1];
  // parede de armários cortando a circulação entre a entrada e a sala
  const f = { type: "armario", x: 3.0, y: 5.6, w: 2.0, h: 0.5 };
  const m = buildModel({ ...p, furniture: [...p.furniture, f] });
  assert.ok(checkModel(m).length > 0);
});

test("collides: lista vazia, tangente, e ponto exatamente sobre a face da parede", () => {
  const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  assert.equal(collides([], 0.5, 0.5), false);
  assert.equal(collides([box], 1.25, 0.5, 0.25), false, "tangente exata não é colisão");
  assert.equal(collides([box], 1.249, 0.5, 0.25), true);
  assert.equal(collides([box], 1.0, 0.5, 0.25), true, "centro sobre a face colide");
  assert.equal(collides([box], 0.5, 0.5, 0.25), true, "centro dentro colide");
  // cantos: distância diagonal
  assert.equal(collides([box], 1.17, 1.17, 0.25), true);
  assert.equal(collides([box], 1.2, 1.2, 0.25), false);
});

test("collides: ponto exatamente no eixo de cada parede do modelo colide", () => {
  for (const p of plans) {
    const m = bares.get(p.id);
    for (const w of m.walls.filter((q) => q.z0 < DIM.head)) {
      assert.ok(collides(m.colliders, ...center(w)), `${p.id}: ${w.kind} sem colisão no centro`);
    }
  }
});

test("borda: círculo de raio 0 com centro dentro de uma caixa deveria colidir", () => {
  const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  assert.equal(collides([box], 0.5, 0.5, 0), true);
});

test("slideMove: desliza ao longo da parede e para no obstáculo; sem movimento fica parado", () => {
  const wall = { x0: 2, y0: -10, x1: 2.1, y1: 10 };
  const end = slideMove([wall], [1, 0], [3, 1]);
  assert.ok(end[0] < 2 - 0.25 + 0.06, `atravessou a parede: ${end}`);
  assert.ok(end[1] > 0.5, `não deslizou ao longo da parede: ${end}`);
  assert.deepEqual(slideMove([wall], [1, 0], [1, 0]), [1, 0]);
});

test("findPath: origem igual ao destino e destino impossível", () => {
  const m = models.get("studio");
  const v = m.rooms[0].visit;
  const mesmo = findPath(m, v, v);
  assert.ok(mesmo && Math.hypot(mesmo[mesmo.length - 1][0] - v[0], mesmo[mesmo.length - 1][1] - v[1]) < 0.1);
  // longe de qualquer lugar caminhável (alcance de 2 m na malha): sem caminho
  assert.equal(findPath(m, v, [100, 100]), null);
});

test("findPath contorna a parede interna: de A a B passa pelo vão da porta, não em linha reta", () => {
  const m = models.get("studio");
  const banho = m.rooms.find((r) => r.full === "Banho");
  const estar = m.rooms[0];
  const path = findPath(m, estar.visit, banho.visit);
  assert.ok(path);
  const reta = Math.hypot(estar.visit[0] - banho.visit[0], estar.visit[1] - banho.visit[1]);
  assert.ok(pathLength(path) >= reta - 1e-6);
  // passa pelo vão (x entre 0.7 e 1.5, y ~ 1.8)
  assert.ok(path.some(([x, y]) => x > 0.6 && x < 1.6 && Math.abs(y - 1.8) < 0.5), `caminho não passa pela porta: ${JSON.stringify(path)}`);
});
