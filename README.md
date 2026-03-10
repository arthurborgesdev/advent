# Advent

Dungeon crawler 2D em TypeScript para browser, com engine propria em canvas, servidor WebSocket local para multiplayer e arquitetura autoritativa de simulacao.

## Rodar

```bash
npm install
npm run dev
```

## Multiplayer local

Em um terminal:

```bash
npm run server
```

Em outro:

```bash
npm run dev
```

Abra duas abas ou janelas no navegador. Para diferenciar nomes, voce pode usar:

```text
http://127.0.0.1:4173/?name=Arthur
http://127.0.0.1:4173/?name=Guest
```

Se o servidor nao estiver rodando, o cliente cai automaticamente para uma sessao local single-player.

## Deploy no Render

O projeto esta preparado para um unico Web Service no Render, servindo:

- frontend estatico a partir de `dist/`
- servidor autoritativo do jogo
- WebSocket em `/ws`

Arquivos relevantes:

- [render.yaml](/Users/arthurborges/projects/advent/render.yaml)
- [server.ts](/Users/arthurborges/projects/advent/server/server.ts)

Fluxo esperado no Render:

1. Conectar o repositorio
2. Criar o servico via Blueprint ou usando o `render.yaml`
3. Build command: `npm install && npm run build`
4. Start command: `npm run start`

O servidor expoe `GET /healthz` para health check.

Build de producao:

```bash
npm run build
```

## Controles

- `WASD`: mover
- `Space`: ataque de espada
- `F`: magia
- `E`: interagir, colher recursos, entrar/sair de dungeon
- `I`: inventario
- `C`: crafting
- `R`: respawn quando morrer
- Mouse: clicar nos botoes de inventario e crafting

## Escopo desta iteracao

- Mundo aberto procedural em preto e branco
- Dungeon procedural com entrada no mapa
- Combate em tempo real com espada e magia
- Multiplayer online/local via WebSocket com estado autoritativo no servidor
- Inimigos com comportamentos distintos:
  - `slime`: vagueia e persegue quando voce entra no raio
  - `shade`: sentinela que so ativa quando voce se aproxima
  - `stalker`: patrulha e circunda o alvo quando engaja
  - `wisp`: orbita e dispara projeteis
- Drops, recursos, XP e level up
- Crafting de consumiveis e upgrades da espada
- Fallback local single-player quando o servidor nao esta disponivel
