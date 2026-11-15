/* ============================================================================
   Mirante Aroeira: o que o tour 3D (tour.js) e o espelho de vendas
   (espelho.js) têm de igual. Só coisas pequenas e sem estado: contas de
   interpolação, as cores do céu e do sol pela altura do sol, o ângulo da
   bússola e os textos do controle de sol.

   O laço de render, a câmera e a cena ficam em cada página: são parecidos,
   mas cada uma tem as suas regras (o tour tem o modo caminhar).
   ========================================================================== */
import * as THREE from "three";
import { northVector, cardinal, formatHour, MONTHS } from "./sun.js";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// Valor que não é número conta como o início da faixa (t = 0): sem isso um
// NaN de elevação atravessava o clamp e pintava céu e luz de NaN.
export const smooth = (a, b, v) => {
  const raw = (v - a) / (b - a);
  const t = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0;
  return t * t * (3 - 2 * t);
};
export const ease = (t) => t * t * (3 - 2 * t);
export const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
export const coarsePointer = matchMedia("(pointer: coarse)");

/* ------------------------------------------------------------ céu e sol -- */
const NIGHT = new THREE.Color(0x0c111d), DUSK = new THREE.Color(0xe2a878), DAY = new THREE.Color(0xbfd5e6);
const SUN_LOW = new THREE.Color(0xffb27a), SUN_HIGH = new THREE.Color(0xfff4e2);

/** Cor do céu pela elevação do sol (graus): noite, crepúsculo, dia. Escreve em out. */
export function skyColor(elevation, out) {
  return elevation < 2
    ? out.copy(NIGHT).lerp(DUSK, smooth(-8, 2, elevation))
    : out.copy(DUSK).lerp(DAY, smooth(2, 14, elevation));
}

/** Cor da luz do sol: alaranjada perto do horizonte, quase branca no alto. */
export function sunColor(elevation, out) {
  return out.lerpColors(SUN_LOW, SUN_HIGH, smooth(4, 38, elevation));
}

/** 0 com o sol no horizonte, 1 a partir de 16° de altura. */
export const sunStrength = (elevation) => smooth(0, 16, elevation);

/** 0 = noite, 1 = dia claro. */
export const daylight = (elevation) => smooth(-6, 10, elevation);

/* ---------------------------------------------------------------- bússola -- */
const fwd = new THREE.Vector3();

/**
 * Ângulo (graus, horário) em que o norte cai na tela para a câmera dada.
 * north é o campo "north" da planta ou da torre.
 */
export function needleAngle(camera, north) {
  camera.getWorldDirection(fwd);
  let gx = fwd.x, gz = fwd.z;
  if (Math.hypot(gx, gz) < 0.08) {               // olhando de topo: usa o "para cima" da tela
    fwd.set(0, 1, 0).applyQuaternion(camera.quaternion);
    gx = fwd.x; gz = fwd.z;
  }
  const l = Math.hypot(gx, gz) || 1;
  gx /= l; gz /= l;
  const [nx, nz] = northVector(north);
  // direita da tela no piso = frente x cima = (-gz, gx)
  return THREE.MathUtils.radToDeg(Math.atan2(nx * -gz + nz * gx, nx * gx + nz * gz));
}

/* ------------------------------------------------------ controle de sol -- */

/** Preenche o <select> de mês com os doze meses, em maiúscula inicial. */
export function fillMonths(select, value) {
  for (const [i, name] of MONTHS.entries()) {
    const o = document.createElement("option");
    o.value = String(i + 1);
    o.textContent = name[0].toUpperCase() + name.slice(1);
    select.append(o);
  }
  select.value = String(value);
}

/**
 * Textos do controle de sol.
 * @returns {{ hora: string, texto: string, frase: string }}
 *          hora "10h00"; texto "Sol a 38° de altura, a norte."; frase "10h00 em junho. Sol a..."
 */
export function describeSun(pos, hour, month) {
  // Mesma tolerância de dayOfYear em sun.js: mês inválido cai em junho, fora
  // de 1 a 12 fica na ponta; hora inválida cai no meio-dia.
  const m = Number.isFinite(month) ? clamp(Math.round(month), 1, 12) : 6;
  const hora = formatHour(Number.isFinite(hour) ? hour : 12);
  const texto = pos.elevation > 0
    ? `Sol a ${Math.round(pos.elevation)}° de altura, a ${cardinal(pos.azimuth)}.`
    : "Sol abaixo do horizonte.";
  return { hora, texto, frase: `${hora} em ${MONTHS[m - 1]}. ${texto}` };
}
