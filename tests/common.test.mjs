// tour/common.js importa three e consulta matchMedia ao carregar: o Node não
// tem matchMedia, então um stub mínimo entra ANTES do import dinâmico.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

let C;
before(async () => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  C = await import("../tour/common.js");
});

test("clamp: limites e dentro; NaN não escapa da faixa nem vira outro valor", () => {
  assert.equal(C.clamp(5, 0, 1), 1);
  assert.equal(C.clamp(-5, 0, 1), 0);
  assert.equal(C.clamp(0.4, 0, 1), 0.4);
  const r = C.clamp(NaN, 0, 1);
  assert.ok(Number.isNaN(r) || (r >= 0 && r <= 1), `clamp(NaN) = ${r}`);
});

test("lerp, smooth e ease: extremos e meio", () => {
  assert.equal(C.lerp(10, 20, 0), 10);
  assert.equal(C.lerp(10, 20, 1), 20);
  assert.equal(C.lerp(10, 20, 0.5), 15);
  assert.equal(C.ease(0), 0);
  assert.equal(C.ease(1), 1);
  assert.equal(C.ease(0.5), 0.5);
  assert.equal(C.smooth(0, 10, -5), 0);
  assert.equal(C.smooth(0, 10, 50), 1);
  assert.equal(C.smooth(0, 10, 5), 0.5);
});

test("smooth: faixa degenerada (a == b) não devolve NaN", () => {
  for (const v of [-1, 0, 1]) {
    const r = C.smooth(2, 2, v);
    assert.ok(Number.isFinite(r) && r >= 0 && r <= 1, `smooth(2,2,${v}) = ${r}`);
  }
});

test("sunStrength e daylight: 0 no horizonte/noite, 1 no alto e sempre em [0,1]", () => {
  assert.equal(C.sunStrength(0), 0);
  assert.equal(C.sunStrength(-30), 0);
  assert.equal(C.sunStrength(16), 1);
  assert.equal(C.sunStrength(90), 1);
  assert.equal(C.daylight(-6), 0);
  assert.equal(C.daylight(-90), 0);
  assert.equal(C.daylight(10), 1);
  for (let e = -90; e <= 90; e += 3) for (const f of [C.sunStrength, C.daylight]) {
    const v = f(e);
    assert.ok(v >= 0 && v <= 1, `${f.name}(${e}) = ${v}`);
  }
});

test("sunStrength e daylight são monotônicos com a elevação", () => {
  for (const f of [C.sunStrength, C.daylight]) {
    let prev = -1;
    for (let e = -90; e <= 90; e += 1) {
      const v = f(e);
      assert.ok(v >= prev - 1e-12, `${f.name} em ${e}`);
      prev = v;
    }
  }
});

test("skyColor e sunColor: escrevem em out, devolvem o mesmo objeto e variam com a elevação", () => {
  const out = new THREE.Color();
  assert.equal(C.skyColor(30, out), out);
  const dia = out.getHex();
  C.skyColor(-20, out);
  const noite = out.getHex();
  assert.notEqual(dia, noite);
  C.skyColor(-90, out);
  assert.equal(out.getHex(), noite, "muito abaixo do horizonte satura na noite");
  C.skyColor(90, out);
  assert.equal(out.getHex(), dia, "muito alto satura no dia");
  assert.equal(C.sunColor(0, out), out);
  const baixo = out.getHex();
  C.sunColor(60, out);
  assert.notEqual(out.getHex(), baixo);
});

test("skyColor e sunColor com NaN não contaminam a cor com NaN", () => {
  const out = new THREE.Color();
  for (const f of [C.skyColor, C.sunColor]) {
    f(NaN, out);
    assert.ok(Number.isFinite(out.r) && Number.isFinite(out.g) && Number.isFinite(out.b), `${f.name}(NaN) -> ${out.r},${out.g},${out.b}`);
  }
});

test("describeSun: texto com sol acima e abaixo do horizonte", () => {
  const d = C.describeSun({ elevation: 38.4, azimuth: 0 }, 10, 6);
  assert.equal(d.hora, "10h00");
  assert.equal(d.texto, "Sol a 38° de altura, a norte.");
  assert.equal(d.frase, "10h00 em junho. Sol a 38° de altura, a norte.");
  assert.equal(C.describeSun({ elevation: -5, azimuth: 0 }, 3, 1).texto, "Sol abaixo do horizonte.");
  assert.equal(C.describeSun({ elevation: 0, azimuth: 0 }, 6, 1).texto, "Sol abaixo do horizonte.", "elevação 0 não é sol acima");
});

test("describeSun: hora fora da faixa mantém texto finito", () => {
  for (const hour of [-1, 25, 99.5]) {
    const d = C.describeSun({ elevation: 10, azimuth: 90 }, hour, 6);
    assert.doesNotMatch(d.frase, /NaN|undefined/, `hora ${hour}: ${d.frase}`);
  }
});

test("describeSun: hora NaN não vira 'NaNhNaN' no texto", () => {
  const d = C.describeSun({ elevation: 10, azimuth: 90 }, NaN, 6);
  assert.doesNotMatch(d.frase, /NaN|undefined/, d.frase);
});

test("describeSun: mês fora de 1 a 12 não vira 'undefined' no texto", () => {
  for (const month of [0, 13, NaN]) {
    const d = C.describeSun({ elevation: 10, azimuth: 90 }, 10, month);
    assert.doesNotMatch(d.frase, /NaN|undefined/, `mês ${month}: ${d.frase}`);
  }
});

test("needleAngle: olhando para o norte marca 0, para o leste marca 90 em módulo, de topo não dá NaN", () => {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 5, 0);
  cam.lookAt(0, 5, -1);
  cam.updateMatrixWorld(true);
  assert.ok(Math.abs(C.needleAngle(cam, 0)) < 1e-6);
  cam.lookAt(1, 5, 0);
  cam.updateMatrixWorld(true);
  assert.ok(Math.abs(Math.abs(C.needleAngle(cam, 0)) - 90) < 1e-6);
  cam.position.set(0, 50, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  assert.ok(Number.isFinite(C.needleAngle(cam, 0)));
});

test("fillMonths: doze opções com valor 1 a 12, inicial maiúscula e mês selecionado", () => {
  const opts = [];
  const select = { append: (o) => opts.push(o), value: "" };
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: () => ({ value: "", textContent: "" }) };
  try {
    C.fillMonths(select, 6);
  } finally {
    if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document;
  }
  assert.equal(opts.length, 12);
  assert.equal(opts[0].textContent, "Janeiro");
  assert.equal(opts[2].textContent, "Março");
  assert.equal(opts[5].textContent, "Junho");
  assert.equal(opts[11].value, "12");
  assert.equal(select.value, "6");
});
