# Advent

Primeira iteracao de um dungeon crawler 2D em TypeScript para browser, com engine propria em canvas e arquitetura preparada para evoluir para multiplayer.

## Rodar

```bash
npm install
npm run dev
```

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
- Inimigos, drops, recursos, XP e level up
- Crafting de consumiveis e upgrades da espada
- Camada de sessao local separada da simulacao para facilitar migracao para multiplayer
