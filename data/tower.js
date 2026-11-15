/**
 * Dados da torre do Mirante Aroeira para o espelho de vendas (espelho.html).
 * Módulo ESM puro, como data/plans.js: nenhum import, roda no Node e no
 * navegador. A geometria 3D sai de tour/tower.js; aqui ficam só os números.
 *
 * DISPONIBILIDADE ILUSTRATIVA. O empreendimento é fictício: os status abaixo
 * foram escritos à mão para a demonstração e não representam venda nenhuma.
 *
 * Unidade: metros. Sistema da laje igual ao das plantas: origem no canto
 * superior esquerdo, x para a direita, y para baixo. O lado de y = 0 é a
 * FRENTE da torre.
 *
 *   north   mesma convenção de data/plans.js: graus no sentido horário entre o
 *           "para cima" do plano (a frente da torre) e o norte. Com north = 0 a
 *           frente olha para o norte e os fundos para o sul.
 *
 * ---------------------------------------------------------------------------
 * Como a laje foi resolvida
 *
 * Cada planta tem uma testada (o lado da varanda) e uma profundidade, tiradas
 * de w/h em data/plans.js:
 *
 *   studio        varanda no lado direito da planta  -> testada 5,0   profundidade 7,6
 *   dois-quartos  varanda no alto da planta          -> testada 9,0   profundidade 8,0
 *   tres-suites   varanda no alto da planta          -> testada 15,5  profundidade 8,0
 *
 * A laje é uma lâmina de 18 x 20 m com corredor central: uma faixa de 8 m de
 * apartamentos na frente (y de 0 a 8), uma faixa de 4 m com corredor,
 * elevadores e escada (y de 8 a 12) e outra faixa de 8 m nos fundos (y de 12 a
 * 20). Todo apartamento tem a varanda numa fachada e a porta de entrada no
 * lado oposto, que é o do corredor, como nas plantas.
 *
 *   18 m de largura = 2 x 9,0: os dois-quartos fecham a largura exata.
 *   Studios:      3 x 5,0 = 15 m, centrados, sobra 1,5 m em cada ponta.
 *   Três suítes:  1 x 15,5 m, centrado, sobra 1,25 m em cada ponta.
 *   As sobras nas pontas são terraços técnicos (condensadoras, prumadas),
 *   escondidos pelas empenas de brises que cobrem as duas laterais da torre.
 *   A profundidade do studio (7,6) deixa 0,4 m a mais para o corredor.
 *
 *   Por andar:  studio 3 + 3 = 6     dois-quartos 2 + 2 = 4     três suítes 1 + 1 = 2
 *   No total:   6 x 5 andares = 30   4 x 6 andares = 24         2 x 4 andares = 8     -> 62 unidades
 *
 * Numeração: andar + final de dois dígitos (1302 = andar 13, final 02). Os
 * finais contam primeiro a frente, da esquerda para a direita, depois os
 * fundos, também da esquerda para a direita (vistos na planta da laje).
 *
 * ---------------------------------------------------------------------------
 * Coerência com o tour 3D
 *
 * O azimute da varanda de cada planta no tour (planAzimuth em tour/tower.js,
 * calculado a partir do "north" dela em data/plans.js) é: studio a 345°,
 * dois-quartos a 15°, três suítes a 0°. Os três caem em
 * "norte". Aqui a frente da torre aponta para 0° (norte), então:
 *
 *   mesma orientação do tour (varanda a norte):
 *     studio        finais 01, 02 e 03
 *     dois-quartos  finais 01 e 02 (o 02 é a planta espelhada)
 *     tres-suites   final 01
 *   orientação oposta (varanda a sul):
 *     studio        finais 04, 05 e 06
 *     dois-quartos  finais 03 e 04 (o 03 é a planta espelhada)
 *     tres-suites   final 02
 *
 * A diferença de até 15° entre a planta do tour e a fachada da torre não muda
 * o ponto cardeal nem a leitura de "sol da manhã na varanda".
 * tour/tower.js (checkTower) confere tudo isto contra data/plans.js.
 *
 * ---------------------------------------------------------------------------
 * Mudar unidades e status
 *
 *   - Status: mova o número do apartamento entre RESERVADAS e VENDIDAS (quem
 *     não está em nenhuma das duas listas está disponível).
 *   - Posição ou quantidade por andar: edite LAYOUT. Cada item é uma coluna de
 *     apartamentos: { final, facade, x, flip }.
 *   - Andares de cada tipologia: edite "bands" (e o data-floors do index.html).
 *   Depois rode a conferência descrita no README.
 */

export const STATUSES = Object.freeze(["disponivel", "reservada", "vendida"]);

const SLAB = { w: 18, d: 20 };

/** Andares de cada tipologia, do mais baixo para o mais alto. */
const BANDS = [
  { plan: "studio", from: 2, to: 6 },
  { plan: "dois-quartos", from: 7, to: 12 },
  { plan: "tres-suites", from: 13, to: 16 },
];

/** Testada (ao longo da fachada) e profundidade de cada planta, em metros. */
const SIZE = {
  "studio": { frontage: 5.0, depth: 7.6 },
  "dois-quartos": { frontage: 9.0, depth: 8.0 },
  "tres-suites": { frontage: 15.5, depth: 8.0 },
};

/**
 * Colunas de apartamentos de cada tipologia. x é o canto esquerdo na laje.
 * facade: "frente" (y = 0) ou "fundos" (y = 20). flip espelha a planta ao
 * longo da fachada, para as varandas dos dois-quartos ficarem nos cantos da
 * torre e os quartos no meio, nas duas fachadas.
 */
const LAYOUT = {
  "studio": [
    { final: 1, facade: "frente", x: 1.5 },
    { final: 2, facade: "frente", x: 6.5 },
    { final: 3, facade: "frente", x: 11.5 },
    { final: 4, facade: "fundos", x: 1.5 },
    { final: 5, facade: "fundos", x: 6.5 },
    { final: 6, facade: "fundos", x: 11.5 },
  ],
  "dois-quartos": [
    { final: 1, facade: "frente", x: 0 },
    { final: 2, facade: "frente", x: 9, flip: true },
    { final: 3, facade: "fundos", x: 0, flip: true },
    { final: 4, facade: "fundos", x: 9 },
  ],
  "tres-suites": [
    { final: 1, facade: "frente", x: 1.25 },
    { final: 2, facade: "fundos", x: 1.25 },
  ],
};

/* Status fixos (ilustrativos). Quem não aparece aqui está disponível. */
const RESERVADAS = [1502, 1301, 1102, 903, 801, 505, 302];
const VENDIDAS = [1601, 1602, 1501, 1401, 1201, 1202, 1101, 1001, 702, 603, 601, 402];

function buildUnits() {
  const units = [];
  for (const band of BANDS) {
    const size = SIZE[band.plan];
    for (let floor = band.from; floor <= band.to; floor++) {
      for (const col of LAYOUT[band.plan]) {
        const id = floor * 100 + col.final;
        units.push({
          id,
          floor,
          plan: band.plan,
          // retângulo ocupado na laje: w ao longo de x, d ao longo de y
          x: col.x,
          y: col.facade === "frente" ? 0 : SLAB.d - size.depth,
          w: size.frontage,
          d: size.depth,
          facade: col.facade,
          flip: !!col.flip,
          status: VENDIDAS.includes(id) ? "vendida" : RESERVADAS.includes(id) ? "reservada" : "disponivel",
        });
      }
    }
  }
  return units;
}

export const tower = {
  floors: 16,              // o andar 1 é o térreo (lobby); a cobertura é de uso comum
  north: 0,                // a frente da torre olha para o norte
  floorHeight: 3.1,        // de piso a piso nos andares de apartamentos
  groundHeight: 6.2,       // térreo com pé-direito duplo
  slab: SLAB,
  // elevadores e escada, dentro da faixa do corredor (y de 8 a 12)
  core: { x: 6, y: 8, w: 6, d: 4 },
  bands: BANDS,
  units: buildUnits(),
};
