# LoL Overlay

Overlay em Electron que lê a **Live Client Data API** da Riot durante a partida,
mostra o time inimigo (ícones, splash, KDA, itens), seus itens e dicas de
itemização. Os dados estáticos vêm do **Data Dragon**, com cache em disco por patch.

## Rodar

```bash
npm install
npm start            # com o LoL aberto, em Janela ou Borderless
npm run mock         # terminal 1: simula a Live API (tempo 20x)
npm run start:mock   # terminal 2: overlay apontando para o mock
npm test
```

Atalhos: `Ctrl+Shift+O` overlay sempre visível · `Ctrl+Shift+Q` sair.

## Champ select

O app fala com o cliente do LoL (LCU, local, sem chave de API) e mostra:

- **Sugestões de pick** com nota de 0 a 100 e os motivos. Quatro critérios com peso
  ajustável (⚙): maestria e histórico na rota, meta (tier da rota), counters contra
  inimigos já revelados e equilíbrio de dano AD/AP do time. Critério sem dado é
  ignorado e os pesos restantes são reescalados.
- **Seu pool** por rota e **lista de nunca sugerir**, também em ⚙.
- **Seu time** com os Riot IDs e o botão **OP.GG multisearch**.

Os nomes seguem o que o cliente mostra: se ele esconde um jogador
(`nameVisibilityType`), o app também esconde. Não há tentativa de descobrir nomes
ocultos, então em ranked só o seu time aparece.

**Dados:** vêm do servidor MCP oficial do OP.GG (`mcp-api.op.gg`), com cache de 12 h na pasta
de dados: tier list por rota, e por campeão/rota as runas, feitiços, itens (inicial, botas, core,
4º-6º), ordem de skills, win rate e counters (quem o counteria / quem ele counteria). Uma requisição
por vez, com intervalo mínimo. Se o OP.GG falhar, o app usa o cache antigo e avisa no topo da janela.
Dá para desligar em ⚙.

## Em partida

Também em partida: **build do matchup** (itens, runas e feitiços contra o oponente de rota, quando há
amostra suficiente), **aviso de recall** quando o ouro fecha um item caro, e **alertas** quando um inimigo
fecha item relevante (corta-cura, revive, remove CC, penetração; lista em `data/enemy-alerts.json`).

- O overlay **só aparece enquanto você segura TAB** (hook global de teclado; o jogo precisa estar em
  Janela ou Borderless). Se o hook não carregar, ele fica sempre visível e `Ctrl+Shift+O` alterna.
- Ele mostra **3 compras sugeridas** com o motivo e o ouro que falta: caminho do meta (build do OP.GG
  para o seu campeão e rota) misturado com itens reativos (anti-cura, armadura, RM, penetração, botas),
  citando os campeões inimigos que motivaram a sugestão. Regras e IDs em `data/reactive-items.json`.
- O app em si é uma **janela normal** (alt-tab funciona).

## Bans, sinergia e ready check

- Na fase de **ban** aparecem sugestões: campeões que counteram os seus melhores picks e os de tier alto na rota.
- O picker ganhou o critério **sinergia** com aliados já escolhidos (peso em ⚙).
- ⚙ também liga o **aceitar partida automaticamente** (desligado por padrão).

## Se o overlay não aparecer

1. Ao abrir o app, um painel de exemplo aparece por 4 s sobre a tela. Se não aparece, a janela do overlay não está sendo exibida.
2. ⚙ → **Testar overlay (5 s)** repete esse teste; ⚙ → **Diagnóstico** mostra o hook de teclado, o leitor direto da tecla TAB, a Live API e o monitor usado.
3. O app guarda um log em `%APPDATA%\lol-overlay\overlay.log` (eventos de TAB, de partida e erros).
4. Alternativa: ⚙ → Overlay em partida → "Sempre visível". O jogo precisa estar em Janela ou Borderless.

## Importar runas, feitiços e itens

No champ select, escolha um campeão no carrossel e use **Importar** no guia: cria/atualiza a página
de runas "LoL Overlay · Campeão" no cliente (e a seleciona), define os feitiços (Flash em F) e cria o
conjunto de itens "LoL Overlay · Campeão" na loja. Com o oponente de rota revelado, usa a versão do matchup.

Seu **meta.json** continua valendo e sempre vence os dados da internet (modelo em `data/meta.json`).
Copie para a pasta de dados (botão "Pasta de dados" em ⚙, `%APPDATA%\lol-overlay`
no Windows) e edite a cópia:

```json
{ "tiers": { "bottom": { "Jinx": "A", "Kai'Sa": "S" } },
  "counters": { "Ashe": { "Caitlyn": 0.6, "Jinx": -0.4 } } }
```

`counters.<inimigo>.<seu campeão>` vai de -1 (péssimo contra) a 1 (ótimo contra).
Configurações ficam em `settings.json` na mesma pasta.

## Instalar e gerar o instalador

```bash
npm run dist:setup   # gera dist/LoL Overlay Setup <versão>.exe (Linux, macOS ou Windows, sem wine)
npx electron-builder --win zip   # versão portable (pasta zipada)
```

O Setup instala por usuário (sem administrador) em `%LOCALAPPDATA%\Programs\LoL Overlay`, cria atalhos na
área de trabalho e no menu Iniciar, registra o desinstalador e preserva as configurações
(`%APPDATA%\lol-overlay`) ao desinstalar. Rodar o Setup de novo atualiza por cima.

A saída fica em `dist/`. O executável não é assinado, então o Windows SmartScreen
pode avisar na primeira execução.

## Estrutura

| Arquivo | Função |
|---|---|
| `src/liveClient.js` | Consulta `https://127.0.0.1:2999/liveclientdata/allgamedata` (TLS relaxado só em loopback) |
| `src/ddragon.js` | Campeões e itens do Data Dragon + cache offline |
| `src/state.js` | Payload cru -> estado limpo (eu, aliados, inimigos, oponente de rota, objetivos) |
| `src/recommender.js` | **Ponto de encaixe das builds.** Hoje: dano AD/AP, corta-cura, penetração, inimigos fortes |
| `data/champion-flags.json` | Listas editáveis (curandeiros, overrides de dano AD/AP) |
| `src/engine.js` | Polling a cada 2 s -> estado -> recomendador -> overlay |
| `src/lcu.js`, `src/profile.js` | Credenciais e requests do cliente; maestria e histórico por rota |
| `src/champSelect.js`, `src/lcuEngine.js` | Estado do champ select, nomes visíveis, loop do cliente |
| `src/picker.js` | Recomendação de picks (4 sinais com pesos) |
| `src/settings.js`, `src/meta.js` | Configurações do usuário e dados de meta/counters |
| `src/providers/` | cliente do OP.GG MCP (parser, cache em disco) |
| `src/buys.js` | Próximas 3 compras (meta + reativos) |
| `src/guide.js`, `src/importer.js` | Guia do campeão e import de runas/feitiços no cliente |
| `src/opgg.js` | Link da multisearch do OP.GG |
| `src/router.js` | Partida > champ select > aguardando |
| `renderer/` | UI do overlay (sem innerHTML: nomes de jogadores são tratados como texto) |
| `mock/mockServer.js` | Live API falsa para desenvolver sem partida |

## Próximo passo

Matchup específico (build contra o oponente de rota) e macro mais fina (timing de corta-cura, etc.).

## Versionamento e atualização automática

- O app instalado verifica atualizações no GitHub Releases ao abrir (e a cada 4 h); baixa em segundo plano e mostra o botão **"Reiniciar e atualizar"** no topo. Dá para desligar em Configurações ou forçar com "Verificar atualização".
- Sem DevTools, sem menu e sem atalhos de navegador no app instalado. Para depurar em desenvolvimento: `LOL_DEVTOOLS=1 npm start`.

### Publicar uma versão

1. Suba o `version` no `package.json` (ex.: 0.8.0 → 0.8.1).
2. `git add -A && git commit -m "..." && git push`.
3. O GitHub Actions gera o Release `vX.Y.Z` com `LoL-Overlay-Setup-X.Y.Z.exe`. Quem tem o app instalado recebe a atualização (ou clica em "Procurar atualizações").

Use sempre o Setup gerado pelo GitHub Release para a primeira instalação (o `npm run dist:local` gera um instalador só para teste local, sem canal de atualização).
