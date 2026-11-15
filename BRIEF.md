# BRIEF: Mirante Aroeira

Entrevista parcial. O dono respondeu quatro decisões por múltipla escolha e deu o
pedido inicial em texto livre. O resto foi decidido por mim e está marcado como
**[autoral]**. O empreendimento é fictício.

## Pedido original (literal)

> Faça um site com o intuito de ajudar/ mostrar apartamentos e prédios para o
> público. Faça no estilo de sites da Apple onde conforme você desce a página vai
> aparecendo os apartamentos, as plantas. Faça o vídeo e as imagens do prédio na
> higgsfield.

## Respostas do dono

| Pergunta | Resposta |
|---|---|
| Prédio real ou fictício | Fictício |
| Créditos Higgsfield (saldo: 10) | Grok Lite para o vídeo (5) mais cerca de 8 imagens (2) |
| Stack | HTML, CSS e JS puros |
| Tom visual | Escuro e cinematográfico |

## Os oito tópicos

1. **Vibe.** Escuro, cinematográfico, calmo, preciso. Referência dada pelo dono:
   páginas de produto da Apple. **[autoral]** Referências de fora da web: fotografia
   de arquitetura na hora azul; a prancha de um arquiteto sendo desenhada.
2. **Jornada, nas palavras do dono.** "conforme você desce a página vai aparecendo
   os apartamentos, as plantas". **[autoral]** Sequência: o prédio de fora, a
   entrada, as plantas dos três apartamentos, as áreas comuns, a ficha, a visita.
3. **Curva de energia.** **[autoral]** Abre alto (o prédio inteiro), cai para o
   silêncio (uma frase e o lobby), sobe para o pico (as plantas), relaxa nas áreas
   comuns, fica seco na ficha técnica e termina parado na vista.
4. **Sensação e o momento único.** **[autoral]** Ver curva e pico abaixo.
5. **O que nenhum outro site faz.** **[autoral]** A planta do apartamento se
   desenha sob a mão de quem rola, parede por parede, e o prédio ao lado acende os
   andares onde aquele apartamento fica.
6. **Distância do premium-minimal.** Nenhuma: o dono pediu Apple e escolheu
   "escuro e cinematográfico". Família: premium-minimal.
7. **Mundo único ou cenas distintas.** **[autoral]** Cenas distintas. Um voo
   contínuo exigiria vários vídeos encadeados e o saldo paga um só.
8. **Assets existentes.** Nenhum. Mundo totalmente gerado na Higgsfield, exceto as
   plantas, que são SVG escrito à mão (geradores erram cotas e texto).

## Dados do empreendimento (fictícios, rotulados no rodapé)

- Nome: Mirante Aroeira. 16 andares (o que a fachada gerada mostra). Bairro fictício: Alto da Serra.
- Studio, 38 m², andares 2 a 6.
- Dois quartos, 72 m², andares 7 a 12.
- Três suítes, 124 m², andares 13 a 16.
- Ação única da página: **Agendar visita**.
- Frase que a página instala: "Dá para entender o apartamento inteiro antes de pisar nele."

## Gramática

**Filmic one-shot.** O dono pediu literalmente a rolagem de página de produto da
Apple com vídeo, que é esta gramática. Por que as outras sete perderam:

- Chaptered editorial: proíbe o hero em vídeo de tela cheia, que foi pedido.
- Live surface: não há produto de software para operar.
- Continuous world: exige voo encadeado de vários vídeos; o saldo paga um.
- Typographic poster: proíbe fotografia, e o pedido é mostrar o prédio.
- Gallery / catalog: a mais próxima (três tipologias são uma coleção), mas proíbe
  a afirmação única no hero e a página precisa carregar um sentimento, não só listar.
- Split stage: não há dois lados em disputa.
- Rhythmic cutlist: energia errada para um imóvel; a decisão é lenta.

## Curva de sensação

```
1  Deslumbre     o prédio inteiro na hora azul, a câmera se aproximando sob a mão
2  Quietude      uma frase em tipo grande e a porta do lobby se abrindo num wipe
3  Encantamento  a planta se desenha sozinha, os cômodos acendem, os andares acendem
4  Apetite       as áreas comuns passando de lado, cada uma inteira
5  Confiança     a ficha técnica seca, em lista, sem enfeite
6  Decisão       tudo para na vista da varanda, um formulário curto
```

## O pico

Ato 3. A frase que o visitante diria a um amigo:

> A planta do apartamento foi se desenhando na tela enquanto eu rolava, e o
> prédio do lado acendia os andares onde ele ficava.

Recebe o maior span da página, o ato anterior é o mais quieto, e as três fotos de
interior ficam aqui.

## Frase "é o site onde"

É o site onde a planta do apartamento se desenha na sua frente enquanto você rola.

## Movimento-assinatura

Planta em SVG com `stroke-dashoffset` dirigido pelo progresso do ato: paredes
externas, paredes internas, portas e janelas, depois as cotas e os nomes dos
cômodos. Ao lado, um corte do prédio com 16 faixas que acende os andares da
tipologia em tela. A tipologia vista por último vai pré-selecionada para o
formulário de visita.

## Partitura

| # | Batida | Sensação | Dispositivo | Span (vh) | Por quê |
|---|---|---|---|---|---|
| 1 | Chegada | Deslumbre | `scrub` + parallax de névoa | 2.4 | O único vídeo, gasto na abertura |
| 2 | Entrada | Quietude | `flow` + `reveal` | ~1.3 | Sem pin: o silêncio antes do pico |
| 3 | Plantas | Encantamento | `pin` + desenho SVG próprio | 4.6 | O pico, maior span |
| 4 | Áreas comuns | Apetite | `pan` | 3.2 | Lateral lê como "opções" |
| 5 | Ficha | Confiança | `flow` + `in` | ~1.2 | Informação, comprimida |
| 6 | Visita | Decisão | `pin` + formulário | 1.15 | A página para e pede uma ação |

Famílias: scrub, flow/in, reveal, pin, pan, kinetic, parallax. Nenhuma repetida
em sequência. Um único scrub. Sem contadores: não há número verificado. Sem
`magnet` nem `spotlight` no fechamento: um botão de enviar que foge do cursor
atrapalha mais do que encanta. Comprimento medido: 12,7 alturas de tela.

## Camadas do hero

| Plano | Asset | Movimento | Regra |
|---|---|---|---|
| Fundo e sujeito | Vídeo da torre (push-in) | Dirigido pelo scroll | Torre no terço central, sobrevive ao corte retrato |
| Atmosfera | Névoa em gradiente, CSS | Parallax mais lento que a página | Só na base, não lava a torre |
| Tipografia | `<h1>` e parágrafo em HTML | 1x, some no cue | Legível no primeiro quadro |
| Saída | A moldura do vídeo encolhe e ganha raio | `clip-path` pelo progresso | Resolve na seção seguinte |

Limite assumido: não há recortes alfa de torre e primeiro plano. O saldo de 10
créditos não cobre placa limpa, recorte e vídeo ao mesmo tempo, e o dono pediu vídeo.

## Silêncio autoral

Nenhuma tela vazia proposital. O ato 2 é quieto, mas tem conteúdo.

## Preâmbulo de estilo (verbatim em todo prompt)

> Architectural photography, photorealistic, full-frame camera with a 24mm
> tilt-shift lens, vertical lines perfectly straight. Blue hour just after sunset:
> deep indigo sky fading to a thin band of warm amber at the horizon, warm amber
> light glowing from interiors, cool ambient fill. Contemporary Brazilian
> residential architecture: dark bronze metal fins, board-formed concrete,
> floor-to-ceiling glass, warm wood ceilings, lush tropical planting. Muted
> cinematic colour grade of deep blue-charcoal with warm amber highlights, deep
> clean shadows, fine film grain. NOT 3D render, NOT CGI, NOT illustration, no
> plastic sheen. No people, no text, no logos, no signage, no watermark.
