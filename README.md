# Mirante Aroeira

Página de demonstração de um empreendimento residencial fictício. Site estático:
HTML, CSS e JS puros, sem framework e sem etapa de build.

## Rodar

A página não funciona abrindo o `index.html` direto (`file://`): o motor baixa o
vídeo com `fetch`, e o navegador bloqueia isso fora de um servidor. Sirva a pasta:

```bash
npx serve .
```

Qualquer servidor estático serve (Vercel, Netlify, GitHub Pages). A raiz do
deploy é esta pasta.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | A página inteira, em HTML semântico |
| `site.css` | Cores, tipografia e layout deste site |
| `site.js` | O desenho das plantas pelo scroll e o formulário de visita |
| `scrollcraft.js`, `scrollcraft.css` | Motor de scroll (terceiros). Não editar |
| `data/plans.js` | Os dados das três plantas, em metros. Fonte única da planta 2D e do tour 3D |
| `tools/plans.mjs` | Gera as plantas em SVG a partir de `data/plans.js` e injeta no `index.html` |
| `tour.html`, `tour.css`, `tour/` | Tour 3D das plantas (ver abaixo) |
| `espelho.html`, `espelho.css`, `data/tower.js` | Espelho de vendas: a torre em 3D com as unidades (ver abaixo) |
| `tools/vendor.mjs`, `vendor/` | Cópia local do three.js usada pelo tour |
| `assets/` | Imagens e vídeo usados pela página |
| `out/` | Originais gerados na Higgsfield (PNG e MP4 sem compressão extra). Fica só na sua máquina: está no `.gitignore` |
| `tests/` | Testes (`npm test`) |
| `BRIEF.md` | As decisões de direção: jornada, curva de sensação, partitura |

## Mudar uma planta

As plantas não são desenhadas à mão. Os cômodos estão em `data/plans.js` como
retângulos em metros, e a área de cada um sai da própria geometria. Depois de
editar os dados:

```bash
npm run plantas
```

O script reescreve o trecho entre os marcadores `<!--plan:ID-->` do
`index.html` e falha se a soma dos cômodos não bater com a área anunciada.

## Tour 3D

Cada planta da landing tem um link "Entrar no tour 3D", que abre
`tour.html?planta=<id>` (`studio`, `dois-quartos` ou `tres-suites`). O
apartamento é montado por código a partir de `data/plans.js`, em dois modos:
maquete (de cima, sem teto) e caminhar (por dentro, com teto), com lista de
ambientes e controle de hora e mês para o sol.

No painel ficam:

- um mini-mapa da planta, com o ambiente atual destacado e, no caminhar, a
  posição e a direção do olhar do visitante. Clicar num ambiente do mapa faz o
  mesmo que a lista na maquete; no caminhar, anda até o ponto clicado;
- a barra de ambientes: um botão com o ambiente atual que abre a lista.
  Escolher um ambiente leva sempre à vista de topo dele (câmera reta para
  baixo, com o alto da planta no alto da tela), inclusive saindo do caminhar.
  "Apartamento inteiro" volta à vista inicial;
- o controle de luz: hora e mês do sol, e as luzes da casa (liga e desliga,
  cor branca ou amarela). É um ponto de luz por ambiente, dois nos ambientes
  compridos (`lightSpots` em `tour/geometry.js`), sem sombra.

| Arquivo | O que é |
|---|---|
| `tour.html`, `tour.css` | A página e o layout. Usa as cores e fontes de `site.css`; não carrega o motor de scroll |
| `tour/geometry.js` | Planta -> paredes, janelas, portas, móveis, colisão, caminhos e pontos de luz. Sem three.js, roda no Node |
| `tour/minimap.js` | O SVG do mini-mapa e a conta da vista de topo de um ambiente. Sem three.js, roda no Node |
| `tour/sun.js` | Posição do sol por mês e hora (latitude -23,5°). Sem three.js |
| `tour/tour.js` | A cena em three.js, a câmera e os controles |
| `vendor/three/` | three.js copiado de `node_modules`, carregado pelo import map de `tour.html` |

**Mobiliar ou alterar uma planta.** Tudo em `data/plans.js` (o comentário no
topo do arquivo explica cada campo):

- `furniture`: um item por móvel, `{ type, x, y, w, h, rot }`, em metros, no
  mesmo sistema da planta. `rot` diz para que lado ficam as costas do móvel
  (0 = para cima, 90 = direita, 180 = baixo, 270 = esquerda). Os tipos e as
  alturas estão em `FURNITURE` (`tour/geometry.js`) e o desenho de cada um em
  `FURNITURE_DRAW` (`tour/tour.js`).
- `north`: para onde aponta o norte, em graus no sentido horário a partir do
  alto da planta. É o que decide por onde o sol entra.
- `floor` em cada cômodo: `madeira`, `pedra` ou `deck`.

Depois de mexer, confira se nenhum móvel ficou atravessando parede, na frente
de porta ou fechando a passagem para algum cômodo:

```bash
node -e "import('./data/plans.js').then(async ({plans}) => { const g = await import('./tour/geometry.js'); for (const p of plans) console.log(p.id, g.checkModel(g.buildModel(p))); })"
```

Uma lista vazia por planta quer dizer que está tudo certo. Se mudou paredes ou
cômodos, rode também `npm run plantas`.

**Atualizar o three.js.** O site não usa CDN nem bundler: os arquivos do three
ficam em `vendor/three/` e entram no repositório.

```bash
npm install --save-dev three@latest
npm run vendor
```

`npm run vendor` copia só o que o tour importa (o módulo principal, os arquivos
que ele puxa e o `OrbitControls`) e grava a versão em `vendor/three/VERSION`.

## Espelho de vendas

`espelho.html` mostra a torre inteira em 3D, com um apartamento clicável por
unidade, a grade de unidades por andar, a ficha de cada uma (tipologia, área,
andar, orientação da varanda, horas de sol na fachada) e o mesmo controle de
sol do tour. A landing chega nele pela ficha técnica, e o tour pelo link "Ver
as unidades na torre". `espelho.html?unidade=1302` abre com a unidade
escolhida e `?planta=<id>` com a tipologia em destaque.

**A disponibilidade é ilustrativa.** O empreendimento é fictício: os status
(disponível, reservada, vendida) foram escritos à mão em `data/tower.js` e a
própria página avisa isso. Nenhuma unidade está à venda.

| Arquivo | O que é |
|---|---|
| `espelho.html`, `espelho.css` | A página e o que é só dela. A casca (barra, cena, painel, gaveta no celular, interruptor `.switch`) vem de `tour.css` |
| `data/tower.js` | A torre: andares, laje, norte, e cada unidade com posição, fachada e status. O comentário no topo explica como a laje foi resolvida |
| `tour/tower.js` | Torre -> lajes, volumes das unidades, varandas, vidros, brises, térreo, cobertura e entorno; orientação, sol na fachada, contagem e validação. Sem three.js, roda no Node |
| `tour/espelho.js` | A cena em three.js, a câmera, a grade e a ficha |
| `tour/common.js` | O que o tour e o espelho têm de igual: cores do céu e do sol, ângulo da bússola, textos do controle de sol |

**Mudar unidades e status.** Tudo em `data/tower.js`:

- Status: mova o número do apartamento entre as listas `RESERVADAS` e
  `VENDIDAS`. Quem não está em nenhuma está disponível.
- Unidades por andar e posição na laje: `LAYOUT`, uma coluna de apartamentos
  por item (`final`, `facade`, `x`, `flip`).
- Andares de cada tipologia: `BANDS` (e o `data-floors` do `index.html`).
- `north` da torre: mesma convenção das plantas. Com 0, a frente olha para o
  norte.

Depois de mexer, confira (lista vazia quer dizer que está tudo certo: números
únicos, unidades dentro da laje e sem sobreposição, tipologia certa em cada
andar, medidas iguais às da planta):

```bash
node -e "import('./data/tower.js').then(async ({tower}) => { const {plans} = await import('./data/plans.js'); const t = await import('./tour/tower.js'); console.log(t.checkTower(tower, plans)); })"
```

As horas de sol da ficha valem para a fachada (sol acima do horizonte e à
frente dela), somadas nas marcas do controle de sol. Não contam a sombra de
vizinhos nem a da laje de cima sobre a varanda.

## Trocar pelos dados reais

1. Nome, textos e ficha técnica: direto no `index.html`.
2. Plantas e metragens: `data/plans.js`, depois `npm run plantas`. O tour 3D lê
   o mesmo arquivo e acompanha sozinho.
3. Andares de cada planta: atributo `data-floors` de cada `<article class="unit">`
   e `BANDS` em `data/tower.js`. Unidades e disponibilidade reais: `data/tower.js`
   (e tire o aviso de disponibilidade ilustrativa do `espelho.html`).
4. E-mail de contato: atributo `action` do formulário (`mailto:`). O endereço
   atual usa o domínio reservado `.example` e não existe.
5. Rodapé: remover o aviso de empreendimento fictício.

## O formulário

Não há backend. O botão abre o aplicativo de e-mail da pessoa com a mensagem
pronta, e quem envia é ela. Nada é enviado nem guardado por este site. Para
receber os pedidos num servidor, troque o `action` por um endpoint próprio.

## Limites conhecidos

- O vídeo do hero é 720p (1280x704), o que o saldo de créditos permitia. Em
  telas grandes ele fica levemente macio.
- As imagens têm 1344 px de largura.
- Testado em Chrome sem interface (desktop, notebook, celular e movimento
  reduzido). Não foi testado em iPhone nem em Safari reais.
- O tour 3D foi conferido só no Edge sem interface, com WebGL por software.
  Falta testar em celular de verdade (toque, desempenho) e em Safari.
- O espelho de vendas também foi conferido só no Edge sem interface (1440x900
  e 390x800, mouse e toque simulado). Falta celular de verdade e Safari.
- O three.js vai sem minificar (cerca de 2,1 MB antes da compressão do
  servidor): o pacote do npm não traz mais a versão minificada e o site não
  tem etapa de build.
