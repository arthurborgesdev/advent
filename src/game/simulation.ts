import {
  DUNGEON_ENEMY_RESPAWN,
  ENEMY_DESPAWN_DISTANCE,
  ENEMY_RADIUS,
  ENEMY_SPAWN_DISTANCE,
  MAX_ENEMIES,
  MAX_RESOURCES,
  MESSAGE_TTL,
  OVERWORLD_ENEMY_RESPAWN,
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_BASE_SPEED,
  PLAYER_CAST_COOLDOWN,
  PLAYER_INTERACT_COOLDOWN,
  PLAYER_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL,
  RESOURCE_RADIUS,
  RESOURCE_SPAWN_DISTANCE,
  WORLD_SEED,
} from "./config";
import { RECIPES } from "./data";
import type {
  AttackEffectSnapshot,
  ClientCommand,
  DungeonSnapshot,
  EnemyBehavior,
  EnemyKind,
  EnemySnapshot,
  Facing,
  InventoryItem,
  MessageEntry,
  PickupSnapshot,
  PlayerIntent,
  PlayerSnapshot,
  ProjectileSnapshot,
  ResourceKind,
  ResourceSnapshot,
  ServerSnapshot,
  SessionConnection,
  TileKind,
  Vec2,
  WorldMode,
} from "./protocol";
import { hash2d, rand01 } from "./random";
import {
  buildDungeon,
  getDungeonEntrance,
  getOverworldTile,
  getResourceCandidate,
  isWalkableTile,
  tileToWorld,
  worldToTile,
} from "./worldgen";

type ProjectileOwnerKind = "player" | "enemy";

type ProjectileModel = ProjectileSnapshot & {
  vx: number;
  vy: number;
  damage: number;
  ownerId: string;
  ownerKind: ProjectileOwnerKind;
};

type EnemyModel = EnemySnapshot & {
  vx: number;
  vy: number;
  damage: number;
  cooldown: number;
  anchor: Vec2;
  aggroUntil: number;
  patrolIndex: number;
  phase: number;
};

type ResourceModel = ResourceSnapshot;

type PlayerModel = PlayerSnapshot & {
  areaId: string;
  intent: PlayerIntent;
  lastIntent: PlayerIntent;
  messages: MessageEntry[];
  overworldReturn: Vec2;
};

type AreaState = {
  id: string;
  mode: WorldMode;
  dungeon: DungeonSnapshot | null;
  players: Set<string>;
  enemies: Map<string, EnemyModel>;
  projectiles: Map<string, ProjectileModel>;
  pickups: Map<string, PickupSnapshot>;
  resources: Map<string, ResourceModel>;
  attackEffects: AttackEffectSnapshot[];
  deadEnemies: Map<string, number>;
  depletedResources: Map<string, number>;
};

const OVERWORLD_AREA_ID = "overworld";

const ZERO_INTENT: PlayerIntent = {
  moveX: 0,
  moveY: 0,
  attack: false,
  cast: false,
  interact: false,
};

export class GameSimulation {
  private readonly seed: number;
  private tick = 0;
  private now = 0;
  private nextId = 1;
  private readonly players = new Map<string, PlayerModel>();
  private readonly areas = new Map<string, AreaState>();

  constructor(seed = WORLD_SEED) {
    this.seed = seed;
    this.getOrCreateArea(OVERWORLD_AREA_ID);
  }

  addPlayer(name = "") {
    const id = `p-${this.nextId++}`;
    const spawn = this.findSafeSpawn();
    const player: PlayerModel = {
      id,
      name: name || `Player ${this.players.size + 1}`,
      x: spawn.x,
      y: spawn.y,
      hp: 100,
      maxHp: 100,
      mana: 40,
      maxMana: 40,
      level: 1,
      xp: 0,
      nextXp: 6,
      facing: "down",
      weaponTier: 1,
      inventory: makeInventory(),
      alive: true,
      attackCooldown: 0,
      castCooldown: 0,
      interactCooldown: 0,
      areaId: OVERWORLD_AREA_ID,
      intent: { ...ZERO_INTENT },
      lastIntent: { ...ZERO_INTENT },
      messages: [],
      overworldReturn: spawn,
    };
    player.inventory.wood = 2;
    player.inventory.essence = 1;
    this.players.set(id, player);
    this.getOrCreateArea(OVERWORLD_AREA_ID).players.add(id);
    this.pushMessage(player, "Joined the overworld.");
    return id;
  }

  removePlayer(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    const area = this.areas.get(player.areaId);
    area?.players.delete(playerId);
    this.players.delete(playerId);
    this.cleanupEmptyDungeonAreas();
  }

  handleCommand(playerId: string, command: ClientCommand) {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    if (command.type === "set-intent") {
      player.intent = command.intent;
      return;
    }
    if (command.type === "craft") {
      this.craft(player, command.recipeId);
      return;
    }
    if (command.type === "use-item") {
      this.useItem(player, command.itemId);
      return;
    }
    if (command.type === "respawn") {
      this.respawn(player);
    }
  }

  update(dt: number) {
    const clampedDt = Math.min(dt, 0.05);
    this.tick += 1;
    this.now += clampedDt;

    for (const area of this.areas.values()) {
      this.decayArea(area, clampedDt);
      this.spawnNearby(area);
      this.updatePlayers(area, clampedDt);
      this.updateProjectiles(area, clampedDt);
      this.updateEnemies(area, clampedDt);
      this.collectPickups(area);
      this.cleanupFarEntities(area);
    }

    this.cleanupEmptyDungeonAreas();
  }

  getSnapshot(playerId: string, connection: SessionConnection = "local"): ServerSnapshot {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error(`Missing player ${playerId}`);
    }

    const area = this.getOrCreateArea(player.areaId);
    const players = [...area.players]
      .map((id) => this.players.get(id))
      .filter((entry): entry is PlayerModel => Boolean(entry))
      .map((entry) => this.toPlayerSnapshot(entry));
    const localPlayer = players.find((entry) => entry.id === playerId) ?? this.toPlayerSnapshot(player);

    return {
      tick: this.tick,
      seed: this.seed,
      connection,
      areaId: area.id,
      mode: area.mode,
      onlinePlayers: this.players.size,
      playerId,
      player: localPlayer,
      players,
      enemies: [...area.enemies.values()].map((enemy) => this.toEnemySnapshot(enemy)),
      projectiles: [...area.projectiles.values()].map((projectile) => this.toProjectileSnapshot(projectile)),
      pickups: [...area.pickups.values()].map((pickup) => ({ ...pickup })),
      resources: [...area.resources.values()].map((resource) => ({ ...resource })),
      attackEffects: area.attackEffects.map((effect) => ({ ...effect })),
      dungeon: area.dungeon,
      messages: player.messages.map((message) => ({ ...message })),
    };
  }

  private getOrCreateArea(areaId: string) {
    const existing = this.areas.get(areaId);
    if (existing) {
      return existing;
    }

    const area: AreaState =
      areaId === OVERWORLD_AREA_ID
        ? {
            id: areaId,
            mode: "overworld",
            dungeon: null,
            players: new Set(),
            enemies: new Map(),
            projectiles: new Map(),
            pickups: new Map(),
            resources: new Map(),
            attackEffects: [],
            deadEnemies: new Map(),
            depletedResources: new Map(),
          }
        : {
            id: areaId,
            mode: "dungeon",
            dungeon: buildDungeon(this.seed, areaId.replace("dungeon:", "")),
            players: new Set(),
            enemies: new Map(),
            projectiles: new Map(),
            pickups: new Map(),
            resources: new Map(),
            attackEffects: [],
            deadEnemies: new Map(),
            depletedResources: new Map(),
          };
    this.areas.set(areaId, area);
    return area;
  }

  private decayArea(area: AreaState, dt: number) {
    area.attackEffects = area.attackEffects
      .map((effect) => ({ ...effect, ttl: effect.ttl - dt }))
      .filter((effect) => effect.ttl > 0);

    for (const enemy of area.enemies.values()) {
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.aggro = enemy.aggroUntil > this.now;
    }

    for (const projectile of area.projectiles.values()) {
      projectile.ttl -= dt;
    }

    for (const playerId of area.players) {
      const player = this.players.get(playerId);
      if (!player) {
        continue;
      }
      player.attackCooldown = Math.max(0, player.attackCooldown - dt);
      player.castCooldown = Math.max(0, player.castCooldown - dt);
      player.interactCooldown = Math.max(0, player.interactCooldown - dt);
      player.mana = Math.min(player.maxMana, player.mana + dt * 2.2);
      player.messages = player.messages
        .map((message) => ({ ...message, ttl: message.ttl - dt }))
        .filter((message) => message.ttl > 0);
    }
  }

  private updatePlayers(area: AreaState, dt: number) {
    for (const playerId of [...area.players]) {
      const player = this.players.get(playerId);
      if (!player) {
        continue;
      }

      if (!player.alive) {
        player.lastIntent = { ...player.intent };
        continue;
      }

      const { moveX, moveY } = player.intent;
      const moveLength = Math.hypot(moveX, moveY) || 1;
      const speed = PLAYER_BASE_SPEED + player.level * 3;
      const vx = (moveX / moveLength) * speed;
      const vy = (moveY / moveLength) * speed;

      if (Math.abs(moveX) > Math.abs(moveY) && moveX !== 0) {
        player.facing = moveX > 0 ? "right" : "left";
      } else if (moveY !== 0) {
        player.facing = moveY > 0 ? "down" : "up";
      }

      player.x = this.tryMove(area, player.x, player.y, vx * dt, 0, PLAYER_RADIUS).x;
      player.y = this.tryMove(area, player.x, player.y, 0, vy * dt, PLAYER_RADIUS).y;

      if (player.intent.attack && !player.lastIntent.attack && player.attackCooldown === 0) {
        this.performAttack(area, player);
      }
      if (player.intent.cast && !player.lastIntent.cast && player.castCooldown === 0) {
        this.performCast(area, player);
      }
      if (player.intent.interact && !player.lastIntent.interact && player.interactCooldown === 0) {
        this.performInteract(area, player);
      }
      player.lastIntent = { ...player.intent };
    }
  }

  private performAttack(area: AreaState, player: PlayerModel) {
    player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
    const offset = directionOffset(player.facing, 18);
    area.attackEffects.push({
      x: player.x + offset.x,
      y: player.y + offset.y,
      dir: player.facing,
      ttl: 0.12,
    });

    const reach = 26;
    for (const enemy of [...area.enemies.values()]) {
      const dx = enemy.x - (player.x + offset.x);
      const dy = enemy.y - (player.y + offset.y);
      if (Math.hypot(dx, dy) <= reach) {
        const damage = 16 + player.weaponTier * 8 + player.level * 2;
        this.damageEnemy(area, enemy.id, damage, player.id);
      }
    }
  }

  private performCast(area: AreaState, player: PlayerModel) {
    const manaCost = 10;
    if (player.mana < manaCost) {
      this.pushMessage(player, "Not enough mana.");
      return;
    }

    player.mana -= manaCost;
    player.castCooldown = PLAYER_CAST_COOLDOWN;
    const dir = directionUnit(player.facing);
    const id = `shot-${this.nextId++}`;
    area.projectiles.set(id, {
      id,
      kind: "bolt",
      x: player.x + dir.x * 12,
      y: player.y + dir.y * 12,
      ttl: PROJECTILE_TTL,
      vx: dir.x * PROJECTILE_SPEED,
      vy: dir.y * PROJECTILE_SPEED,
      damage: 14 + player.level * 3,
      ownerId: player.id,
      ownerKind: "player",
    });
  }

  private performInteract(area: AreaState, player: PlayerModel) {
    player.interactCooldown = PLAYER_INTERACT_COOLDOWN;

    if (area.mode === "overworld") {
      const tile = worldToTile(player.x, player.y);
      const entrance = getDungeonEntrance(this.seed, tile.x, tile.y);
      if (entrance) {
        const door = tileToWorld(entrance.x, entrance.y);
        if (Math.hypot(player.x - door.x, player.y - door.y) < 18) {
          player.overworldReturn = { x: player.x, y: player.y };
          this.movePlayerToArea(player, `dungeon:${entrance.key}`, null);
          this.pushMessage(player, `Entered dungeon ${entrance.key}.`);
          return;
        }
      }
    } else if (area.dungeon) {
      const exitDist = Math.hypot(player.x - area.dungeon.spawn.x, player.y - area.dungeon.spawn.y);
      if (exitDist < 18) {
        this.movePlayerToArea(player, OVERWORLD_AREA_ID, player.overworldReturn);
        this.pushMessage(player, "Returned to the overworld.");
        return;
      }
    }

    let best: ResourceModel | null = null;
    let bestDist = Infinity;
    for (const resource of area.resources.values()) {
      const dist = Math.hypot(player.x - resource.x, player.y - resource.y);
      if (dist < 26 && dist < bestDist) {
        best = resource;
        bestDist = dist;
      }
    }
    if (best) {
      this.harvestResource(area, player, best.id);
      return;
    }

    this.pushMessage(player, "Nothing to interact with.");
  }

  private movePlayerToArea(player: PlayerModel, nextAreaId: string, spawn: Vec2 | null) {
    const currentArea = this.areas.get(player.areaId);
    currentArea?.players.delete(player.id);

    const nextArea = this.getOrCreateArea(nextAreaId);
    nextArea.players.add(player.id);
    player.areaId = nextAreaId;
    const nextSpawn = spawn ?? nextArea.dungeon?.spawn ?? this.findSafeSpawn();
    player.x = nextSpawn.x;
    player.y = nextSpawn.y;
    player.intent = { ...ZERO_INTENT };
    player.lastIntent = { ...ZERO_INTENT };
  }

  private harvestResource(area: AreaState, player: PlayerModel, resourceId: string) {
    const resource = area.resources.get(resourceId);
    if (!resource) {
      return;
    }
    area.resources.delete(resourceId);
    area.depletedResources.set(resourceId, this.now + 16);
    const amount = resource.kind === "essence" ? 2 : 1 + (player.level > 2 ? 1 : 0);
    const pickupId = `drop-${this.nextId++}`;
    area.pickups.set(pickupId, {
      id: pickupId,
      kind: resource.kind,
      x: resource.x,
      y: resource.y,
      amount,
    });
    this.pushMessage(player, `Harvested ${amount} ${resource.kind}.`);
  }

  private updateProjectiles(area: AreaState, dt: number) {
    for (const projectile of [...area.projectiles.values()]) {
      if (projectile.ttl <= 0) {
        area.projectiles.delete(projectile.id);
        continue;
      }

      const moved = this.tryMove(area, projectile.x, projectile.y, projectile.vx * dt, projectile.vy * dt, 2);
      projectile.x = moved.x;
      projectile.y = moved.y;
      if (moved.blocked) {
        area.projectiles.delete(projectile.id);
        continue;
      }

      if (projectile.ownerKind === "player") {
        for (const enemy of [...area.enemies.values()]) {
          if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < ENEMY_RADIUS + 3) {
            this.damageEnemy(area, enemy.id, projectile.damage, projectile.ownerId);
            area.projectiles.delete(projectile.id);
            break;
          }
        }
      } else {
        for (const playerId of area.players) {
          const player = this.players.get(playerId);
          if (!player || !player.alive || player.id === projectile.ownerId) {
            continue;
          }
          if (Math.hypot(projectile.x - player.x, projectile.y - player.y) < PLAYER_RADIUS + 4) {
            this.damagePlayer(player, projectile.damage, "Enemy bolt hit you.");
            area.projectiles.delete(projectile.id);
            break;
          }
        }
      }
    }
  }

  private updateEnemies(area: AreaState, dt: number) {
    for (const enemy of [...area.enemies.values()]) {
      const target = this.findNearestAlivePlayer(area, enemy.x, enemy.y);
      const movement = this.computeEnemyMovement(area, enemy, target);
      enemy.vx = movement.x;
      enemy.vy = movement.y;

      const mx = this.tryMove(area, enemy.x, enemy.y, enemy.vx * dt, 0, ENEMY_RADIUS);
      enemy.x = mx.x;
      const my = this.tryMove(area, enemy.x, enemy.y, 0, enemy.vy * dt, ENEMY_RADIUS);
      enemy.y = my.y;

      if (enemy.kind === "wisp" && target && enemy.aggro && enemy.cooldown === 0) {
        const dist = Math.hypot(target.x - enemy.x, target.y - enemy.y);
        if (dist < 150) {
          const dir = normalize(target.x - enemy.x, target.y - enemy.y);
          const id = `bolt-${this.nextId++}`;
          area.projectiles.set(id, {
            id,
            kind: "bolt",
            x: enemy.x + dir.x * 10,
            y: enemy.y + dir.y * 10,
            ttl: PROJECTILE_TTL,
            vx: dir.x * (PROJECTILE_SPEED * 0.85),
            vy: dir.y * (PROJECTILE_SPEED * 0.85),
            damage: enemy.damage - 2,
            ownerId: enemy.id,
            ownerKind: "enemy",
          });
          enemy.cooldown = 1.15;
        }
      }

      if (!target || enemy.kind === "wisp") {
        continue;
      }

      const dist = Math.hypot(target.x - enemy.x, target.y - enemy.y);
      const meleeRange = enemy.kind === "slime" ? 16 : 18;
      if (dist < PLAYER_RADIUS + ENEMY_RADIUS + meleeRange && enemy.cooldown === 0) {
        enemy.cooldown = enemy.kind === "stalker" ? 0.7 : 0.9;
        this.damagePlayer(target, enemy.damage, `${capitalize(enemy.kind)} hit you.`);
      }
    }
  }

  private computeEnemyMovement(area: AreaState, enemy: EnemyModel, target: PlayerModel | null) {
    const idleOscillation = {
      x: Math.sin(this.now * 0.8 + enemy.phase) * 12,
      y: Math.cos(this.now * 0.6 + enemy.phase) * 12,
    };

    if (target) {
      const targetDist = Math.hypot(target.x - enemy.x, target.y - enemy.y);
      if (
        (enemy.kind === "slime" && targetDist < 112) ||
        (enemy.kind === "shade" && targetDist < 88) ||
        (enemy.kind === "stalker" && targetDist < 146) ||
        (enemy.kind === "wisp" && targetDist < 170)
      ) {
        enemy.aggroUntil = this.now + (enemy.kind === "shade" ? 4 : 3);
      }
    }
    enemy.aggro = enemy.aggroUntil > this.now;

    if (enemy.kind === "slime") {
      const destination = enemy.aggro && target ? { x: target.x, y: target.y } : add(enemy.anchor, idleOscillation);
      return seek(enemy.x, enemy.y, destination.x, destination.y, enemy.aggro ? 52 : 30);
    }

    if (enemy.kind === "shade") {
      if (enemy.aggro && target) {
        return seek(enemy.x, enemy.y, target.x, target.y, 64);
      }
      return seek(enemy.x, enemy.y, enemy.anchor.x, enemy.anchor.y, 28);
    }

    if (enemy.kind === "stalker") {
      if (enemy.aggro && target) {
        const offset = orbitPoint(target, 32, this.now * 1.8 + enemy.phase);
        return seek(enemy.x, enemy.y, offset.x, offset.y, 56);
      }
      const patrolPoints = [
        add(enemy.anchor, { x: 18, y: 0 }),
        add(enemy.anchor, { x: 0, y: 18 }),
        add(enemy.anchor, { x: -18, y: 0 }),
        add(enemy.anchor, { x: 0, y: -18 }),
      ];
      const patrolTarget = patrolPoints[enemy.patrolIndex % patrolPoints.length]!;
      if (Math.hypot(enemy.x - patrolTarget.x, enemy.y - patrolTarget.y) < 8) {
        enemy.patrolIndex += 1;
      }
      return seek(enemy.x, enemy.y, patrolTarget.x, patrolTarget.y, 34);
    }

    if (target && enemy.aggro) {
      const desired = orbitPoint(target, 54, this.now * 2.2 + enemy.phase);
      return seek(enemy.x, enemy.y, desired.x, desired.y, 44);
    }

    const roomTarget = area.mode === "dungeon" && area.dungeon ? area.dungeon.exit : add(enemy.anchor, idleOscillation);
    return seek(enemy.x, enemy.y, roomTarget.x, roomTarget.y, 28);
  }

  private collectPickups(area: AreaState) {
    for (const pickup of [...area.pickups.values()]) {
      for (const playerId of area.players) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) {
          continue;
        }
        if (Math.hypot(player.x - pickup.x, player.y - pickup.y) <= 18) {
          player.inventory[pickup.kind] += pickup.amount;
          area.pickups.delete(pickup.id);
          this.pushMessage(player, `Picked up ${pickup.amount} ${pickup.kind}.`);
          break;
        }
      }
    }
  }

  private cleanupFarEntities(area: AreaState) {
    if (area.players.size === 0) {
      return;
    }

    const positions = [...area.players]
      .map((id) => this.players.get(id))
      .filter((player): player is PlayerModel => Boolean(player))
      .map((player) => ({ x: player.x, y: player.y }));

    for (const enemy of [...area.enemies.values()]) {
      if (!isNearAny(positions, enemy.x, enemy.y, ENEMY_DESPAWN_DISTANCE)) {
        area.enemies.delete(enemy.id);
      }
    }
    for (const resource of [...area.resources.values()]) {
      if (!isNearAny(positions, resource.x, resource.y, RESOURCE_SPAWN_DISTANCE + 80)) {
        area.resources.delete(resource.id);
      }
    }
    for (const pickup of [...area.pickups.values()]) {
      if (!isNearAny(positions, pickup.x, pickup.y, ENEMY_DESPAWN_DISTANCE)) {
        area.pickups.delete(pickup.id);
      }
    }
  }

  private spawnNearby(area: AreaState) {
    if (area.players.size === 0) {
      return;
    }
    this.spawnEnemies(area);
    this.spawnResources(area);
  }

  private spawnEnemies(area: AreaState) {
    if (area.enemies.size >= MAX_ENEMIES) {
      return;
    }

    const players = [...area.players]
      .map((id) => this.players.get(id))
      .filter((player): player is PlayerModel => Boolean(player));

    if (area.mode === "overworld") {
      for (const player of players) {
        const tile = worldToTile(player.x, player.y);
        for (let cy = tile.y - 18; cy <= tile.y + 18; cy += 4) {
          for (let cx = tile.x - 18; cx <= tile.x + 18; cx += 4) {
            const id = `ow-e-${cx}:${cy}`;
            if (area.enemies.has(id) || (area.deadEnemies.get(id) ?? 0) > this.now) {
              continue;
            }
            if (rand01(this.seed + 503, cx, cy) < 0.78) {
              continue;
            }
            const position = tileToWorld(cx, cy);
            if (!isNearAny(players, position.x, position.y, ENEMY_SPAWN_DISTANCE, 72)) {
              continue;
            }
            const tileKind = getOverworldTile(this.seed, cx, cy);
            if (!isWalkableTile(tileKind) || tileKind === "entrance") {
              continue;
            }
            const roll = rand01(this.seed + 509, cx, cy);
            const kind: EnemyKind =
              roll > 0.93 ? "wisp" : roll > 0.79 ? "stalker" : roll > 0.56 ? "shade" : "slime";
            area.enemies.set(id, createEnemy(id, kind, position.x, position.y));
            if (area.enemies.size >= MAX_ENEMIES) {
              return;
            }
          }
        }
      }
      return;
    }

    if (!area.dungeon) {
      return;
    }

    for (const player of players) {
      const tile = worldToTile(player.x, player.y);
      for (let ty = Math.max(2, tile.y - 16); ty < Math.min(area.dungeon.height - 2, tile.y + 16); ty += 4) {
        for (let tx = Math.max(2, tile.x - 16); tx < Math.min(area.dungeon.width - 2, tile.x + 16); tx += 4) {
          const id = `dg-e-${area.dungeon.key}-${tx}:${ty}`;
          if (area.enemies.has(id) || (area.deadEnemies.get(id) ?? 0) > this.now) {
            continue;
          }
          if (rand01(this.seed + 607, tx, ty) < 0.72) {
            continue;
          }
          const index = ty * area.dungeon.width + tx;
          if (area.dungeon.tiles[index] !== "floor") {
            continue;
          }
          const position = tileToWorld(tx, ty);
          if (!isNearAny(players, position.x, position.y, 240, 96)) {
            continue;
          }
          const roll = rand01(this.seed + 613, tx, ty);
          const kind: EnemyKind = roll > 0.84 ? "wisp" : roll > 0.58 ? "stalker" : roll > 0.32 ? "shade" : "slime";
          area.enemies.set(id, createEnemy(id, kind, position.x, position.y, true));
          if (area.enemies.size >= MAX_ENEMIES) {
            return;
          }
        }
      }
    }
  }

  private spawnResources(area: AreaState) {
    if (area.resources.size >= MAX_RESOURCES) {
      return;
    }

    const players = [...area.players]
      .map((id) => this.players.get(id))
      .filter((player): player is PlayerModel => Boolean(player));

    if (area.mode === "overworld") {
      for (const player of players) {
        const tile = worldToTile(player.x, player.y);
        const rx0 = Math.floor((tile.x - 20) / 6);
        const ry0 = Math.floor((tile.y - 20) / 6);
        const rx1 = Math.floor((tile.x + 20) / 6);
        const ry1 = Math.floor((tile.y + 20) / 6);
        for (let ry = ry0; ry <= ry1; ry += 1) {
          for (let rx = rx0; rx <= rx1; rx += 1) {
            const candidate = getResourceCandidate(this.seed, rx, ry);
            if (!candidate) {
              continue;
            }
            const id = `ow-r-${candidate.x}:${candidate.y}`;
            if (area.resources.has(id) || (area.depletedResources.get(id) ?? 0) > this.now) {
              continue;
            }
            const position = tileToWorld(candidate.x, candidate.y);
            if (!isNearAny(players, position.x, position.y, RESOURCE_SPAWN_DISTANCE)) {
              continue;
            }
            area.resources.set(id, {
              id,
              kind: candidate.kind,
              x: position.x,
              y: position.y,
              hp: 1,
              maxHp: 1,
            });
            if (area.resources.size >= MAX_RESOURCES) {
              return;
            }
          }
        }
      }
      return;
    }

    if (!area.dungeon) {
      return;
    }

    for (let ty = 4; ty < area.dungeon.height - 4; ty += 7) {
      for (let tx = 4; tx < area.dungeon.width - 4; tx += 7) {
        const id = `dg-r-${area.dungeon.key}-${tx}:${ty}`;
        if (area.resources.has(id) || (area.depletedResources.get(id) ?? 0) > this.now) {
          continue;
        }
        if (rand01(this.seed + 701, tx, ty) < 0.62) {
          continue;
        }
        const index = ty * area.dungeon.width + tx;
        if (area.dungeon.tiles[index] !== "floor") {
          continue;
        }
        const position = tileToWorld(tx, ty);
        if (!isNearAny(players, position.x, position.y, 260)) {
          continue;
        }
        area.resources.set(id, {
          id,
          kind: "essence",
          x: position.x,
          y: position.y,
          hp: 1,
          maxHp: 1,
        });
        if (area.resources.size >= MAX_RESOURCES) {
          return;
        }
      }
    }
  }

  private damageEnemy(area: AreaState, enemyId: string, amount: number, attackerId: string) {
    const enemy = area.enemies.get(enemyId);
    if (!enemy) {
      return false;
    }

    enemy.hp -= amount;
    enemy.flash = 0.12;
    enemy.aggroUntil = this.now + 4;
    if (enemy.hp > 0) {
      return false;
    }

    area.enemies.delete(enemyId);
    area.deadEnemies.set(enemyId, this.now + (area.mode === "overworld" ? OVERWORLD_ENEMY_RESPAWN : DUNGEON_ENEMY_RESPAWN));
    this.rewardKill(area, enemy, attackerId);
    return true;
  }

  private rewardKill(area: AreaState, enemy: EnemyModel, attackerId: string) {
    const player = this.players.get(attackerId);
    if (!player) {
      return;
    }

    const xpGain = enemy.kind === "wisp" ? 5 : enemy.kind === "stalker" ? 4 : enemy.kind === "shade" ? 3 : 2;
    player.xp += xpGain;
    const amount = enemy.kind === "wisp" ? 2 : 1;
    const kind: InventoryItem =
      enemy.kind === "wisp"
        ? "essence"
        : enemy.kind === "stalker"
          ? "ore"
          : rand01(this.seed + this.tick, Math.floor(enemy.x), Math.floor(enemy.y)) > 0.5
            ? "wood"
            : "essence";
    const dropId = `loot-${this.nextId++}`;
    area.pickups.set(dropId, {
      id: dropId,
      kind,
      x: enemy.x,
      y: enemy.y,
      amount,
    });
    this.pushMessage(player, `${capitalize(enemy.kind)} defeated. +${xpGain} XP.`);

    while (player.xp >= player.nextXp) {
      player.xp -= player.nextXp;
      player.level += 1;
      player.nextXp = 6 + player.level * 5;
      player.maxHp += 12;
      player.maxMana += 6;
      player.hp = player.maxHp;
      player.mana = player.maxMana;
      this.pushMessage(player, `Level up: ${player.level}.`);
    }
  }

  private damagePlayer(player: PlayerModel, amount: number, message: string) {
    player.hp -= amount;
    this.pushMessage(player, message);
    if (player.hp > 0) {
      return;
    }
    player.hp = 0;
    player.alive = false;
    player.intent = { ...ZERO_INTENT };
    player.lastIntent = { ...ZERO_INTENT };
    this.pushMessage(player, "You fell in battle. Press R to respawn.");
  }

  private craft(player: PlayerModel, recipeId: string) {
    const recipe = RECIPES.find((entry) => entry.id === recipeId);
    if (!recipe || !player.alive) {
      return;
    }

    for (const [itemId, cost] of Object.entries(recipe.cost) as Array<[InventoryItem, number]>) {
      if (player.inventory[itemId] < cost) {
        this.pushMessage(player, "Missing materials.");
        return;
      }
    }

    if ("weaponTier" in recipe.output && player.weaponTier >= recipe.output.weaponTier) {
      this.pushMessage(player, "Weapon already upgraded.");
      return;
    }

    for (const [itemId, cost] of Object.entries(recipe.cost) as Array<[InventoryItem, number]>) {
      player.inventory[itemId] -= cost;
    }

    if ("itemId" in recipe.output) {
      player.inventory[recipe.output.itemId] += 1;
      this.pushMessage(player, `${recipe.name} crafted.`);
    } else {
      player.weaponTier = recipe.output.weaponTier;
      this.pushMessage(player, `${recipe.name} forged.`);
    }
  }

  private useItem(player: PlayerModel, itemId: InventoryItem) {
    if (player.inventory[itemId] <= 0 || !player.alive) {
      return;
    }
    if (itemId === "potion") {
      player.inventory[itemId] -= 1;
      player.hp = Math.min(player.maxHp, player.hp + 35);
      this.pushMessage(player, "Potion used.");
      return;
    }
    if (itemId === "ether") {
      player.inventory[itemId] -= 1;
      player.mana = Math.min(player.maxMana, player.mana + 25);
      this.pushMessage(player, "Ether used.");
    }
  }

  private respawn(player: PlayerModel) {
    if (player.alive) {
      return;
    }
    player.alive = true;
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    this.movePlayerToArea(player, OVERWORLD_AREA_ID, this.findSafeSpawn());
    this.pushMessage(player, "Respawned.");
  }

  private tryMove(area: AreaState, x: number, y: number, dx: number, dy: number, radius: number) {
    const nextX = x + dx;
    const nextY = y + dy;
    const blockedX = this.collides(area, nextX, y, radius);
    const blockedY = this.collides(area, x, nextY, radius);
    return {
      x: blockedX ? x : nextX,
      y: blockedY ? y : nextY,
      blocked: blockedX || blockedY,
    };
  }

  private collides(area: AreaState, x: number, y: number, radius: number) {
    const samples = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];
    for (const sample of samples) {
      const tile = this.getTileAt(area, sample.x, sample.y);
      if (!isWalkableTile(tile)) {
        return true;
      }
    }
    for (const resource of area.resources.values()) {
      if (Math.hypot(resource.x - x, resource.y - y) < radius + RESOURCE_RADIUS - 1) {
        return true;
      }
    }
    return false;
  }

  private getTileAt(area: AreaState, x: number, y: number): TileKind {
    const tile = worldToTile(x, y);
    if (area.mode === "dungeon") {
      if (!area.dungeon) {
        return "void";
      }
      if (tile.x < 0 || tile.y < 0 || tile.x >= area.dungeon.width || tile.y >= area.dungeon.height) {
        return "void";
      }
      return area.dungeon.tiles[tile.y * area.dungeon.width + tile.x] ?? "void";
    }
    return getOverworldTile(this.seed, tile.x, tile.y);
  }

  private findNearestAlivePlayer(area: AreaState, x: number, y: number) {
    let best: PlayerModel | null = null;
    let bestDist = Infinity;
    for (const playerId of area.players) {
      const player = this.players.get(playerId);
      if (!player || !player.alive) {
        continue;
      }
      const dist = Math.hypot(player.x - x, player.y - y);
      if (dist < bestDist) {
        best = player;
        bestDist = dist;
      }
    }
    return best;
  }

  private findSafeSpawn() {
    for (let r = 0; r < 32; r += 1) {
      for (let y = -r; y <= r; y += 1) {
        for (let x = -r; x <= r; x += 1) {
          const tile = getOverworldTile(this.seed, x, y);
          if (isWalkableTile(tile) && tile !== "entrance") {
            return tileToWorld(x, y);
          }
        }
      }
    }
    return { x: 0, y: 0 };
  }

  private cleanupEmptyDungeonAreas() {
    for (const [areaId, area] of this.areas.entries()) {
      if (areaId === OVERWORLD_AREA_ID) {
        continue;
      }
      if (area.players.size === 0) {
        this.areas.delete(areaId);
      }
    }
  }

  private pushMessage(player: PlayerModel, text: string) {
    player.messages.unshift({
      id: `msg-${this.nextId++}`,
      text,
      ttl: MESSAGE_TTL,
    });
    if (player.messages.length > 6) {
      player.messages.length = 6;
    }
  }

  private toPlayerSnapshot(player: PlayerModel): PlayerSnapshot {
    const { areaId: _areaId, intent: _intent, lastIntent: _lastIntent, messages: _messages, overworldReturn: _return, ...rest } =
      player;
    return {
      ...rest,
      inventory: { ...rest.inventory },
    };
  }

  private toEnemySnapshot(enemy: EnemyModel): EnemySnapshot {
    const { vx: _vx, vy: _vy, damage: _damage, cooldown: _cooldown, anchor: _anchor, aggroUntil: _aggroUntil, patrolIndex: _patrolIndex, phase: _phase, ...snapshot } =
      enemy;
    return { ...snapshot };
  }

  private toProjectileSnapshot(projectile: ProjectileModel): ProjectileSnapshot {
    const { vx: _vx, vy: _vy, damage: _damage, ownerId: _ownerId, ownerKind: _ownerKind, ...snapshot } = projectile;
    return { ...snapshot };
  }
}

function makeInventory(): Record<InventoryItem, number> {
  return {
    wood: 0,
    ore: 0,
    essence: 0,
    potion: 0,
    ether: 0,
  };
}

function createEnemy(id: string, kind: EnemyKind, x: number, y: number, empowered = false): EnemyModel {
  const behavior: EnemyBehavior =
    kind === "slime" ? "wander" : kind === "shade" ? "sentry" : kind === "stalker" ? "patrol" : "orbit";
  const base = getEnemyBase(kind);
  const hp = empowered ? Math.floor(base.maxHp * 1.25) : base.maxHp;
  return {
    id,
    kind,
    behavior,
    x,
    y,
    hp,
    maxHp: hp,
    flash: 0,
    aggro: false,
    vx: 0,
    vy: 0,
    damage: empowered ? base.damage + 2 : base.damage,
    cooldown: 0,
    anchor: { x, y },
    aggroUntil: 0,
    patrolIndex: Math.floor(rand01(hp, x, y) * 4),
    phase: rand01(hp + 7, x, y) * Math.PI * 2,
  };
}

function getEnemyBase(kind: EnemyKind) {
  if (kind === "shade") {
    return { maxHp: 30, damage: 11 };
  }
  if (kind === "stalker") {
    return { maxHp: 36, damage: 12 };
  }
  if (kind === "wisp") {
    return { maxHp: 24, damage: 10 };
  }
  return { maxHp: 20, damage: 8 };
}

function directionUnit(facing: Facing) {
  if (facing === "up") {
    return { x: 0, y: -1 };
  }
  if (facing === "down") {
    return { x: 0, y: 1 };
  }
  if (facing === "left") {
    return { x: -1, y: 0 };
  }
  return { x: 1, y: 0 };
}

function directionOffset(facing: Facing, amount: number) {
  const dir = directionUnit(facing);
  return { x: dir.x * amount, y: dir.y * amount };
}

function capitalize(value: string) {
  return value[0]!.toUpperCase() + value.slice(1);
}

function normalize(x: number, y: number) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function seek(x: number, y: number, tx: number, ty: number, speed: number) {
  const dir = normalize(tx - x, ty - y);
  return { x: dir.x * speed, y: dir.y * speed };
}

function add(a: Vec2, b: Vec2) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function orbitPoint(center: Vec2, radius: number, angle: number) {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function isNearAny(
  points: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  maxDistance: number,
  minDistance = 0,
) {
  return points.some((point) => {
    const dist = Math.hypot(point.x - x, point.y - y);
    return dist <= maxDistance && dist >= minDistance;
  });
}
