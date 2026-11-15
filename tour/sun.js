/**
 * Posição do sol para o tour 3D. Módulo puro (sem three.js, sem "node:").
 *
 * É uma aproximação de livro, suficiente para mostrar por onde a luz entra:
 *   - declinação pela fórmula de Cooper: 23,44° · sen(360° · (284 + N) / 365),
 *     com N = dia do ano (aqui sempre o dia 15 do mês);
 *   - ângulo horário de 15° por hora a partir do meio-dia SOLAR.
 * Fica de fora: equação do tempo, longitude dentro do fuso, horário de verão
 * e refração atmosférica. O erro é de poucos graus e de até uns 15 minutos em
 * relação ao relógio, o que não muda a leitura de "sol da manhã na varanda".
 *
 * Ângulos em graus. Azimute medido a partir do norte, no sentido horário
 * (0 = norte, 90 = leste, 180 = sul, 270 = oeste). Elevação acima do horizonte
 * (negativa = sol abaixo do horizonte).
 */

export const LATITUDE = -23.5;      // trópico de Capricórnio, aprox. São Paulo

export const MONTHS = Object.freeze([
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]);

const RAD = Math.PI / 180;
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Dia do ano (1 a 365) do dia 15 do mês dado (1 a 12). */
export function dayOfYear(month) {
  // Mês que não é número cai em junho (o padrão do tour): sem isso o NaN
  // atravessava o Math.min/Math.max e contaminava azimute e elevação.
  const m = Number.isFinite(month) ? Math.min(12, Math.max(1, Math.round(month))) : 6;
  return DAYS_BEFORE[m - 1] + 15;
}

/** Declinação solar em graus no dia do ano N. */
export function declination(day) {
  return 23.44 * Math.sin(RAD * (360 * (284 + day)) / 365);
}

/**
 * @param {{ month: number, hour: number, latitude?: number }} when
 *        month 1 a 12, hour em hora solar decimal (12 = sol no ponto mais alto)
 * @returns {{ azimuth: number, elevation: number, declination: number }}
 */
export function sunPosition({ month, hour, latitude = LATITUDE }) {
  const decl = declination(dayOfYear(month));
  const lat = latitude * RAD, d = decl * RAD, H = (hour - 12) * 15 * RAD;
  // vetor do sol no referencial local leste / norte / zênite
  const east = -Math.cos(d) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(d) - Math.sin(lat) * Math.cos(d) * Math.cos(H);
  const up = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H);
  const azimuth = (Math.atan2(east, north) / RAD + 360) % 360;
  const elevation = Math.asin(Math.max(-1, Math.min(1, up))) / RAD;
  return { azimuth, elevation, declination: decl };
}

/**
 * Vetor unitário que aponta da cena para o sol, no sistema da cena 3D
 * (X = x da planta, Y = altura, Z = y da planta).
 *
 * north é o campo "north" da planta: graus no sentido horário entre o "para
 * cima" da planta e o norte. Na cena, o norte é (sen north, 0, -cos north) e
 * o leste é (cos north, 0, sen north); daí o azimute simplesmente se soma.
 * @returns {[number, number, number]}
 */
export function sunDirection({ azimuth, elevation }, north = 0) {
  const a = (azimuth + north) * RAD, e = elevation * RAD;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

/** Norte da planta como vetor [x, y] no plano (y para baixo). */
export function northVector(north = 0) {
  return [Math.sin(north * RAD), -Math.cos(north * RAD)];
}

const CARDINALS = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"];

/** Nome do ponto cardeal ou colateral mais próximo do azimute. */
export function cardinal(azimuth) {
  const a = ((azimuth % 360) + 360) % 360;
  return CARDINALS[Math.round(a / 45) % 8];
}

/** "9h30" a partir de 9.5. */
export function formatHour(hour) {
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}
