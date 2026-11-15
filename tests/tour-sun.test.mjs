import { test } from "node:test";
import assert from "node:assert/strict";
import { sunPosition, sunDirection, northVector, cardinal, formatHour, dayOfYear, LATITUDE, MONTHS } from "../tour/sun.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} esperado ${b} ±${tol}, veio ${a}`);
// diferença angular mínima entre dois azimutes
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("latitude padrão é -23,5 e há 12 meses", () => {
  assert.equal(LATITUDE, -23.5);
  assert.equal(MONTHS.length, 12);
});

test("meio-dia solar em junho: sol ao norte, elevação em torno de 43°", () => {
  const s = sunPosition({ month: 6, hour: 12 });
  assert.ok(angDiff(s.azimuth, 0) < 1, `azimute ${s.azimuth}`);
  near(s.elevation, 43.2, 1);
});

test("meio-dia: elevação em dezembro é maior que em junho (e quase a pino)", () => {
  const jun = sunPosition({ month: 6, hour: 12 }).elevation;
  const dez = sunPosition({ month: 12, hour: 12 }).elevation;
  assert.ok(dez > jun + 30, `dez ${dez} vs jun ${jun}`);
  assert.ok(dez > 85, `dezembro ao meio-dia deveria passar de 85°, veio ${dez}`);
});

test("madrugada: elevação nunca é positiva (horas 0 a 4, todos os meses)", () => {
  for (let m = 1; m <= 12; m++) for (const h of [0, 1, 2, 3, 4]) {
    const e = sunPosition({ month: m, hour: h }).elevation;
    assert.ok(e <= 0, `mês ${m}, ${h}h: elevação ${e}`);
  }
  assert.ok(sunPosition({ month: 6, hour: 12 }).elevation > 0, "controle: meio-dia deve ser positivo");
});

test("simetria manhã/tarde em torno das 12h", () => {
  for (let m = 1; m <= 12; m++) for (const d of [0.5, 1, 3, 5.5]) {
    const a = sunPosition({ month: m, hour: 12 - d }), b = sunPosition({ month: m, hour: 12 + d });
    near(a.elevation, b.elevation, 1e-9, `elevação mês ${m} ±${d}h`);
    assert.ok(angDiff(a.azimuth + b.azimuth, 0) < 1e-6, `azimutes devem somar 360 (mês ${m} ±${d}h): ${a.azimuth} + ${b.azimuth}`);
  }
});

test("de manhã o sol está a leste, à tarde a oeste", () => {
  for (const m of [3, 6, 9, 12]) {
    const manha = sunPosition({ month: m, hour: 9 }).azimuth, tarde = sunPosition({ month: m, hour: 15 }).azimuth;
    assert.ok(manha > 0 && manha < 180, `mês ${m} manhã ${manha}`);
    assert.ok(tarde > 180 && tarde < 360, `mês ${m} tarde ${tarde}`);
  }
});

test("latitude pode ser sobrescrita (hemisfério norte vê o sol ao sul ao meio-dia)", () => {
  const s = sunPosition({ month: 12, hour: 12, latitude: 40 });
  near(s.azimuth, 180, 1);
});

test("sunDirection é unitário para qualquer combinação", () => {
  for (let m = 1; m <= 12; m++) for (let h = 0; h <= 24; h += 1.5) for (const n of [0, 37, 90, 105, 180, 345]) {
    const v = sunDirection(sunPosition({ month: m, hour: h }), n);
    near(Math.hypot(...v), 1, 1e-9, `m${m} h${h} n${n}`);
  }
});

test("sunDirection gira com north (0, 90, 180): o norte do céu aponta para northVector", () => {
  const casos = [[0, [0, 0, -1]], [90, [1, 0, 0]], [180, [0, 0, 1]], [270, [-1, 0, 0]]];
  for (const [n, esperado] of casos) {
    const v = sunDirection({ azimuth: 0, elevation: 0 }, n);
    esperado.forEach((e, i) => near(v[i], e, 1e-9, `north=${n}, eixo ${i}`));
    const nv = northVector(n);
    near(v[0], nv[0], 1e-9); near(v[2], nv[1], 1e-9);
  }
});

test("sunDirection: leste com north=0 é +X; elevação 90 é +Y; elevação negativa desce", () => {
  const e = sunDirection({ azimuth: 90, elevation: 0 }, 0);
  near(e[0], 1, 1e-9); near(e[2], 0, 1e-9);
  const z = sunDirection({ azimuth: 123, elevation: 90 }, 40);
  near(z[1], 1, 1e-9);
  assert.ok(sunDirection({ azimuth: 0, elevation: -10 })[1] < 0);
});

test("sunDirection: north padrão é 0", () => {
  assert.deepEqual(sunDirection({ azimuth: 45, elevation: 20 }), sunDirection({ azimuth: 45, elevation: 20 }, 0));
});

test("dayOfYear fixa meses fora de 1..12 nas pontas", () => {
  assert.equal(dayOfYear(1), 15);
  assert.equal(dayOfYear(12), 349);
  assert.equal(dayOfYear(0), 15);
  assert.equal(dayOfYear(13), 349);
});

test("borda: mês inválido (NaN) não deveria produzir posição NaN", () => {
  const s = sunPosition({ month: NaN, hour: 12 });
  assert.ok(Number.isFinite(s.elevation) && Number.isFinite(s.azimuth), `veio ${JSON.stringify(s)}`);
});

test("cardinal e formatHour", () => {
  assert.equal(cardinal(0), "norte");
  assert.equal(cardinal(359), "norte");
  assert.equal(cardinal(90), "leste");
  assert.equal(cardinal(180), "sul");
  assert.equal(cardinal(-90), "oeste");
  assert.equal(cardinal(450), "leste");
  assert.equal(formatHour(9.5), "9h30");
  assert.equal(formatHour(12), "12h00");
  assert.equal(formatHour(5), "5h00");
  assert.equal(formatHour(11.999), "12h00");
});
