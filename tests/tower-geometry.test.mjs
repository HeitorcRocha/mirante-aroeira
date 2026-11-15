import { test } from "node:test";
import assert from "node:assert/strict";
import { tower } from "../data/tower.js";
import { plans } from "../data/plans.js";
import {
  buildTower, floorLevel, roofLevel, facadeAzimuth, unitAzimuth, unitCardinal, facadeSunlit,
  unitSunlit, facadeSunHours, unitSunHours, SUN_GRID, DIM, FACADES, facadeNormal, unitLabel, unitArea,
} from "../tour/tower.js";
import { sunPosition } from "../tour/sun.js";

const built = buildTower(tower, plans);

test("buildTower: um volume por unidade, com o id certo e sem repetição", () => {
  assert.equal(built.units.length, tower.units.length);
  assert.deepEqual(built.units.map((u) => u.id).sort((a, b) => a - b), tower.units.map((u) => u.id).sort((a, b) => a - b));
});

test("buildTower: cada volume está na altura do andar certo", () => {
  for (const u of built.units) {
    const z0 = floorLevel(tower, u.floor);
    assert.ok(Math.abs(u.bbox.z0 - z0) < 1e-9, `${u.id}: z0 ${u.bbox.z0} esperado ${z0}`);
    assert.ok(Math.abs(u.bbox.z1 - (z0 + DIM.ceiling)) < 1e-9, `${u.id}: z1`);
    assert.ok(u.center[2] > u.bbox.z0 && u.center[2] < u.bbox.z1);
    assert.equal(u.floor, Math.floor(u.id / 100));
  }
});

test("buildTower: andares sobem em ordem e a cobertura fica acima do último", () => {
  for (let f = 2; f <= 16; f++) assert.ok(floorLevel(tower, f) > floorLevel(tower, f - 1));
  assert.equal(floorLevel(tower, 1), 0);
  assert.ok(roofLevel(tower) > floorLevel(tower, 16) + DIM.ceiling - 1e-9);
  assert.ok(built.top > roofLevel(tower));
});

test("buildTower: caixas bem formadas (x0<x1, y0<y1, z0<z1, sem NaN) em todas as listas", () => {
  for (const key of ["slabs", "glass", "frames", "rails", "fins", "columns", "core", "ground", "roof"]) {
    assert.ok(Array.isArray(built[key]), key);
    for (const b of built[key]) {
      for (const k of ["x0", "x1", "y0", "y1", "z0", "z1"]) assert.ok(Number.isFinite(b[k]), `${key}.${k}`);
      assert.ok(b.x0 < b.x1 && b.y0 < b.y1 && b.z0 < b.z1, `${key}: caixa vazia ou invertida ${JSON.stringify(b)}`);
    }
  }
  for (const u of built.units) for (const b of u.body) assert.ok(b.x0 < b.x1 && b.y0 < b.y1 && b.z0 < b.z1, `corpo de ${u.id}`);
});

test("buildTower: o corpo de cada unidade fica dentro do seu bbox", () => {
  for (const u of built.units) for (const b of u.body) {
    assert.ok(b.x0 >= u.bbox.x0 - 1e-9 && b.x1 <= u.bbox.x1 + 1e-9 && b.y0 >= u.bbox.y0 - 1e-9 && b.y1 <= u.bbox.y1 + 1e-9, `corpo de ${u.id} escapa do bbox`);
  }
});

test("buildTower: bbox das unidades acompanha a posição dos dados e cabe em bounds", () => {
  for (const u of built.units) {
    const d = tower.units.find((x) => x.id === u.id);
    assert.deepEqual([u.bbox.x0, u.bbox.y0, u.bbox.x1, u.bbox.y1], [d.x, d.y, d.x + d.w, d.y + d.d]);
    assert.ok(u.bbox.x0 >= built.bounds.x0 && u.bbox.x1 <= built.bounds.x1 && u.bbox.z1 <= built.bounds.z1);
  }
});

test("buildTower: torre sem unidades não quebra e devolve zero volumes", () => {
  const out = buildTower({ ...tower, units: [] }, plans);
  assert.equal(out.units.length, 0);
  assert.ok(out.slabs.length > 0);
});

test("buildTower: unidade com planta inexistente falha com mensagem que a identifica", () => {
  const t = { ...tower, units: [{ ...tower.units[0], plan: "penthouse" }] };
  assert.throws(() => buildTower(t, plans), /penthouse/);
});

test("orientação cardeal da fachada para north 0, 90, 180 e 270", () => {
  const casos = {
    0: { frente: "norte", direita: "leste", fundos: "sul", esquerda: "oeste" },
    90: { frente: "oeste", direita: "norte", fundos: "leste", esquerda: "sul" },
    180: { frente: "sul", direita: "oeste", fundos: "norte", esquerda: "leste" },
    270: { frente: "leste", direita: "sul", fundos: "oeste", esquerda: "norte" },
  };
  const graus = { norte: 0, leste: 90, sul: 180, oeste: 270 };
  for (const [north, mapa] of Object.entries(casos)) {
    for (const [fachada, nome] of Object.entries(mapa)) {
      const t = { ...tower, north: Number(north) };
      assert.equal(facadeAzimuth(t, fachada), graus[nome], `north ${north}, ${fachada}`);
      assert.equal(unitCardinal(t, { facade: fachada }), nome, `north ${north}, ${fachada}`);
    }
  }
});

test("orientação: azimute sempre em [0, 360) e north negativo ou grande funciona", () => {
  for (const north of [-90, 450, 720, 359.9]) {
    for (const f of Object.keys(FACADES)) {
      const a = facadeAzimuth({ north }, f);
      assert.ok(a >= 0 && a < 360, `north ${north} ${f}: ${a}`);
    }
  }
  assert.equal(facadeAzimuth({ north: -90 }, "frente"), 90);
  assert.equal(facadeAzimuth({}, "direita"), 90, "sem north = 0");
});

test("orientação: as unidades dos dados têm varanda a norte (frente) e a sul (fundos)", () => {
  for (const u of tower.units) assert.equal(unitCardinal(tower, u), u.facade === "frente" ? "norte" : "sul", String(u.id));
  assert.equal(unitAzimuth(tower, tower.units[0]), 0);
});

test("facadeNormal aponta para fora em cada fachada", () => {
  const n = (f) => facadeNormal(f).map((v) => v + 0);      // "+ 0" normaliza -0 para 0
  assert.deepEqual(n("frente"), [0, -1]);
  assert.deepEqual(n("direita"), [1, 0]);
  assert.deepEqual(n("fundos"), [0, 1]);
  assert.deepEqual(n("esquerda"), [-1, 0]);
});

const LAT = -23.5;

test("sol: ao meio-dia de junho (lat -23,5) a fachada norte recebe sol e a sul não", () => {
  const sun = sunPosition({ month: 6, hour: 12, latitude: LAT });
  assert.ok(sun.elevation > 0);
  assert.equal(facadeSunlit(0, sun), true, "norte");
  assert.equal(facadeSunlit(180, sun), false, "sul");
  assert.equal(unitSunlit(tower, { facade: "frente" }, sun), true);
  assert.equal(unitSunlit(tower, { facade: "fundos" }, sun), false);
});

test("sol: nunca há sol direto com elevação <= 0 (inclui 0, negativo e NaN)", () => {
  for (const elevation of [0, -0.001, -30, NaN, undefined]) {
    for (const az of [0, 90, 180, 270]) {
      for (const f of [0, 90, 180, 270]) {
        assert.equal(facadeSunlit(f, { azimuth: az, elevation }), false, `elev ${elevation} az ${az} fach ${f}`);
      }
    }
  }
  for (let m = 1; m <= 12; m++) for (let h = 0; h <= 24; h += 0.25) {
    const s = sunPosition({ month: m, hour: h, latitude: LAT });
    for (const f of [0, 90, 180, 270]) if (facadeSunlit(f, s)) assert.ok(s.elevation > 0, `mês ${m} hora ${h}`);
  }
});

test("sol: fachada de costas ou perpendicular ao sol não recebe", () => {
  assert.equal(facadeSunlit(180, { azimuth: 0, elevation: 40 }), false);
  assert.equal(facadeSunlit(90, { azimuth: 0, elevation: 40 }), false, "perpendicular (cos = 0) não conta");
  assert.equal(facadeSunlit(0, { azimuth: 80, elevation: 40 }), true);
});

test("horas de sol: entre 0 e o tamanho da grade, em qualquer mês, fachada e latitude", () => {
  const tam = SUN_GRID.max - SUN_GRID.min;
  for (let m = 1; m <= 12; m++) for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
    for (const lat of [undefined, LAT, 0, 60, -60]) {
      const h = facadeSunHours(az, m, lat);
      assert.ok(Number.isFinite(h), `mês ${m} az ${az} lat ${lat}: ${h}`);
      assert.ok(h >= 0 && h <= tam + SUN_GRID.step, `mês ${m} az ${az} lat ${lat}: ${h}`);
    }
  }
});

test("horas de sol: fachadas opostas não somam mais que as horas de sol acima do horizonte", () => {
  for (let m = 1; m <= 12; m++) {
    let acima = 0;
    for (let h = SUN_GRID.min; h <= SUN_GRID.max + 1e-9; h += SUN_GRID.step) {
      if (sunPosition({ month: m, hour: h }).elevation > 0) acima += SUN_GRID.step;
    }
    for (const az of [0, 90, 45, 135]) {
      const soma = facadeSunHours(az, m) + facadeSunHours(az + 180, m);
      assert.ok(soma <= acima + 1e-9, `mês ${m} az ${az}: ${soma} > ${acima}`);
    }
  }
});

test("horas de sol: norte em junho tem mais sol que sul; sul em dezembro tem algum sol", () => {
  assert.ok(facadeSunHours(0, 6) > 5);
  assert.ok(facadeSunHours(0, 6) > facadeSunHours(180, 6));
  assert.ok(facadeSunHours(180, 12) > 0, "no verão o sol passa por trás da fachada sul");
  assert.equal(unitSunHours(tower, tower.units[0], 6), facadeSunHours(0, 6));
});

test("horas de sol: mês inválido (NaN, 0, 13, string) não gera NaN e NaN cai em junho", () => {
  for (const m of [NaN, undefined, 0, 13, -5, "x", null, Infinity]) {
    const h = facadeSunHours(0, m);
    assert.ok(Number.isFinite(h), `mês ${m} -> ${h}`);
    assert.ok(h >= 0 && h <= 14.5);
  }
  assert.equal(facadeSunHours(0, NaN), facadeSunHours(0, 6));
});

test("horas de sol: latitude extrema não quebra", () => {
  assert.ok(Number.isFinite(facadeSunHours(0, 12, -89)));
  assert.ok(Number.isFinite(facadeSunHours(0, 6, 89)));
});

test("unitLabel: texto acessível com número, andar, orientação, status, e unitArea", () => {
  const u = tower.units.find((x) => x.id === 1302);
  const l = unitLabel(tower, u, plans);
  assert.match(l, /Apartamento 1302/);
  assert.match(l, /13º andar/);
  assert.match(l, /varanda a sul/);
  assert.equal(unitArea(u, plans), 124);
  assert.ok(Number.isNaN(unitArea({ plan: "x" }, plans)));
  assert.match(unitLabel(tower, { id: 1, floor: 2, plan: "x", facade: "frente", status: "vendida" }, plans), /vendida/);
});

test("floorLevel: andar 0 ou negativo cai no térreo (z = 0)", () => {
  assert.equal(floorLevel(tower, 0), 0);
  assert.equal(floorLevel(tower, -3), 0);
  assert.equal(floorLevel(tower, 2), tower.groundHeight);
  assert.equal(floorLevel(tower, 3), tower.groundHeight + tower.floorHeight);
});
