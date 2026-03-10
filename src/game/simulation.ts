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

type EnemyModel = EnemySnapshot & {
  vx: number;
  vy: number;
  damage: number;
  cooldown: number;
};

type ProjectileModel = ProjectileSnapshot & {
  vx: number;
  vy: number;
  damage: number;
  ownerId: string;
};

type ResourceModel = ResourceSnapshot;

type PlayerModel = PlayerSnapshot & {
  intent: PlayerIntent;
  lastIntent: PlayerIntent;
};

type DamageResult = {
  killed: boolean;
};

const ZERO_INTENT: PlayerIntent = {
  moveX: 0,
  moveY: 0,
  attack: false,
  cast: false,
  interact: false,
};

function makeInventory(): Record<InventoryItem, number> {
  return {
    wood: 0,
    ore: 0,
    essence: 0,
    potion: 0,
    ether: 0,
  };
}

export class GameSimulation {
  private readonly seed = WORLD_SEED;
  private readonly playerId = "hero";
  private tick = 0;
  private now = 0;
  private mode: WorldMode = "overworld";
  private dungeon: DungeonSnapshot | null = null;
  private player: PlayerModel = {
    id: this.playerId,
    x: 0,
    y: 0,
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
    intent: { ...ZERO_INTENT },
    lastIntent: { ...ZERO_INTENT },
  };
  private enemies = new Map<string, EnemyModel>();
  private projectiles = new Map<string, ProjectileModel>();
  private pickups = new Map<string, PickupSnapshot>();
  private resources = new Map<string, ResourceModel>();
  private attackEffects: AttackEffectSnapshot[] = [];
  private messages: MessageEntry[] = [];
  private deadEnemies = new Map<string, number>();
  private depletedResources = new Map<string, number>();
  private nextId = 1;
  private overworldReturn: Vec2 = { x: 0, y: 0 };

  constructor() {
    this.player.inventory.wood = 2;
    this.player.inventory.essence = 1;
    this.findSafeSpawn();
  }

  handleCommand(command: ClientCommand) {
    if (command.type === "set-intent") {
      this.player.intent = command.intent;
      return;
    }
    if (command.type === "craft") {
      this.craft(command.recipeId);
      return;
    }
    if (command.type === "use-item") {
      this.useItem(command.itemId);
      return;
    }
    if (command.type === "respawn") {
      this.respawn();
    }
  }

  update(dt: number) {
    const clampedDt = Math.min(dt, 0.05);
    this.tick += 1;
    this.now += clampedDt;
    this.decay(clampedDt);

    if (!this.player.alive) {
      this.player.lastIntent = { ...this.player.intent };
      return;
    }

    this.spawnNearby();
    this.updatePlayer(clampedDt);
    this.updateProjectiles(clampedDt);
    this.updateEnemies(clampedDt);
    this.collectPickups();
    this.cleanupFarEntities();
    this.player.lastIntent = { ...this.player.intent };
  }

  getSnapshot(): ServerSnapshot {
    const { intent: _intent, lastIntent: _lastIntent, ...player } = this.player;
    return {
      tick: this.tick,
      seed: this.seed,
      mode: this.mode,
      playerId: this.playerId,
      player,
      enemies: [...this.enemies.values()],
      projectiles: [...this.projectiles.values()],
      pickups: [...this.pickups.values()],
      resources: [...this.resources.values()],
      attackEffects: this.attackEffects.map((effect) => ({ ...effect })),
      dungeon: this.dungeon,
      messages: this.messages.map((message) => ({ ...message })),
    };
  }

  private findSafeSpawn() {
    for (let r = 0; r < 32; r += 1) {
      for (let y = -r; y <= r; y += 1) {
        for (let x = -r; x <= r; x += 1) {
          const tile = getOverworldTile(this.seed, x, y);
          if (isWalkableTile(tile) && tile !== "entrance") {
            const world = tileToWorld(x, y);
            this.player.x = world.x;
            this.player.y = world.y;
            this.overworldReturn = world;
            return;
          }
        }
      }
    }
  }

  private decay(dt: number) {
    this.player.attackCooldown = Math.max(0, this.player.attackCooldown - dt);
    this.player.castCooldown = Math.max(0, this.player.castCooldown - dt);
    this.player.interactCooldown = Math.max(0, this.player.interactCooldown - dt);
    this.player.mana = Math.min(this.player.maxMana, this.player.mana + dt * 2.2);

    this.attackEffects = this.attackEffects
      .map((effect) => ({ ...effect, ttl: effect.ttl - dt }))
      .filter((effect) => effect.ttl > 0);

    this.messages = this.messages
      .map((message) => ({ ...message, ttl: message.ttl - dt }))
      .filter((message) => message.ttl > 0);

    for (const enemy of this.enemies.values()) {
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      enemy.flash = Math.max(0, enemy.flash - dt);
    }
  }

  private updatePlayer(dt: number) {
    const { moveX, moveY } = this.player.intent;
    const moveLength = Math.hypot(moveX, moveY) || 1;
    const speed = PLAYER_BASE_SPEED + this.player.level * 3;
    const vx = (moveX / moveLength) * speed;
    const vy = (moveY / moveLength) * speed;

    if (Math.abs(moveX) > Math.abs(moveY) && moveX !== 0) {
      this.player.facing = moveX > 0 ? "right" : "left";
    } else if (moveY !== 0) {
      this.player.facing = moveY > 0 ? "down" : "up";
    }

    this.player.x = this.tryMove(this.player.x, this.player.y, vx * dt, 0, PLAYER_RADIUS).x;
    this.player.y = this.tryMove(this.player.x, this.player.y, 0, vy * dt, PLAYER_RADIUS).y;

    if (this.player.intent.attack && !this.player.lastIntent.attack && this.player.attackCooldown === 0) {
      this.performAttack();
    }
    if (this.player.intent.cast && !this.player.lastIntent.cast && this.player.castCooldown === 0) {
      this.performCast();
    }
    if (this.player.intent.interact && !this.player.lastIntent.interact && this.player.interactCooldown === 0) {
      this.performInteract();
    }
  }

  private performAttack() {
    this.player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
    const offset = directionOffset(this.player.facing, 18);
    this.attackEffects.push({
      x: this.player.x + offset.x,
      y: this.player.y + offset.y,
      dir: this.player.facing,
      ttl: 0.12,
    });

    const reach = 26;
    for (const enemy of this.enemies.values()) {
      const dx = enemy.x - (this.player.x + offset.x);
      const dy = enemy.y - (this.player.y + offset.y);
      if (Math.hypot(dx, dy) <= reach) {
        const damage = 16 + this.player.weaponTier * 8 + this.player.level * 2;
        this.damageEnemy(enemy.id, damage);
      }
    }
  }

  private performCast() {
    const manaCost = 10;
    if (this.player.mana < manaCost) {
      this.pushMessage("Not enough mana.");
      return;
    }

    this.player.mana -= manaCost;
    this.player.castCooldown = PLAYER_CAST_COOLDOWN;
    const dir = directionUnit(this.player.facing);
    const id = `shot-${this.nextId++}`;
    this.projectiles.set(id, {
      id,
      kind: "bolt",
      x: this.player.x + dir.x * 12,
      y: this.player.y + dir.y * 12,
      ttl: PROJECTILE_TTL,
      vx: dir.x * PROJECTILE_SPEED,
      vy: dir.y * PROJECTILE_SPEED,
      damage: 14 + this.player.level * 3,
      ownerId: this.player.id,
    });
  }

  private performInteract() {
    this.player.interactCooldown = PLAYER_INTERACT_COOLDOWN;

    if (this.mode === "overworld") {
      const tile = worldToTile(this.player.x, this.player.y);
      const entrance = getDungeonEntrance(this.seed, tile.x, tile.y);
      if (entrance && Math.hypot(this.player.x - tileToWorld(entrance.x, entrance.y).x, this.player.y - tileToWorld(entrance.x, entrance.y).y) < 18) {
        this.overworldReturn = { x: this.player.x, y: this.player.y };
        this.enterDungeon(entrance.key);
        return;
      }
    } else if (this.dungeon) {
      const distToExit = Math.hypot(this.player.x - this.dungeon.spawn.x, this.player.y - this.dungeon.spawn.y);
      if (distToExit < 18) {
        this.leaveDungeon();
        return;
      }
    }

    let best: ResourceModel | null = null;
    let bestDist = Infinity;
    for (const resource of this.resources.values()) {
      const dist = Math.hypot(this.player.x - resource.x, this.player.y - resource.y);
      if (dist < 26 && dist < bestDist) {
        best = resource;
        bestDist = dist;
      }
    }
    if (best) {
      this.harvestResource(best.id);
      return;
    }

    this.pushMessage("Nothing to interact with.");
  }

  private enterDungeon(key: string) {
    this.mode = "dungeon";
    this.dungeon = buildDungeon(this.seed, key);
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.resources.clear();
    this.player.x = this.dungeon.spawn.x;
    this.player.y = this.dungeon.spawn.y;
    this.pushMessage("Dungeon entered.");
  }

  private leaveDungeon() {
    this.mode = "overworld";
    this.dungeon = null;
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.resources.clear();
    this.player.x = this.overworldReturn.x;
    this.player.y = this.overworldReturn.y;
    this.pushMessage("Returned to the overworld.");
  }

  private harvestResource(id: string) {
    const resource = this.resources.get(id);
    if (!resource) {
      return;
    }
    this.resources.delete(id);
    this.depletedResources.set(id, this.now + 16);
    const amount = resource.kind === "essence" ? 2 : 1 + (this.player.level > 2 ? 1 : 0);
    const pickupId = `drop-${this.nextId++}`;
    this.pickups.set(pickupId, {
      id: pickupId,
      kind: resource.kind,
      x: resource.x,
      y: resource.y,
      amount,
    });
    this.pushMessage(`Collected ${amount} ${resource.kind}.`);
  }

  private updateProjectiles(dt: number) {
    for (const projectile of [...this.projectiles.values()]) {
      projectile.ttl -= dt;
      if (projectile.ttl <= 0) {
        this.projectiles.delete(projectile.id);
        continue;
      }

      const moved = this.tryMove(projectile.x, projectile.y, projectile.vx * dt, projectile.vy * dt, 2);
      projectile.x = moved.x;
      projectile.y = moved.y;
      if (moved.blocked) {
        this.projectiles.delete(projectile.id);
        continue;
      }

      for (const enemy of this.enemies.values()) {
        if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < ENEMY_RADIUS + 3) {
          this.damageEnemy(enemy.id, projectile.damage);
          this.projectiles.delete(projectile.id);
          break;
        }
      }
    }
  }

  private updateEnemies(dt: number) {
    for (const enemy of [...this.enemies.values()]) {
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = enemy.kind === "shade" ? 52 : 40;
      enemy.vx = (dx / dist) * speed;
      enemy.vy = (dy / dist) * speed;

      const mx = this.tryMove(enemy.x, enemy.y, enemy.vx * dt, 0, ENEMY_RADIUS);
      enemy.x = mx.x;
      const my = this.tryMove(enemy.x, enemy.y, 0, enemy.vy * dt, ENEMY_RADIUS);
      enemy.y = my.y;

      if (dist < PLAYER_RADIUS + ENEMY_RADIUS + 4 && enemy.cooldown === 0) {
        enemy.cooldown = 0.85;
        this.player.hp -= enemy.damage;
        this.pushMessage(`${capitalize(enemy.kind)} hit you.`);
        if (this.player.hp <= 0) {
          this.player.hp = 0;
          this.player.alive = false;
          this.pushMessage("You fell in battle. Press R to respawn.");
          return;
        }
      }
    }
  }

  private collectPickups() {
    for (const pickup of [...this.pickups.values()]) {
      if (Math.hypot(this.player.x - pickup.x, this.player.y - pickup.y) <= 18) {
        this.player.inventory[pickup.kind] += pickup.amount;
        this.pickups.delete(pickup.id);
        this.pushMessage(`Picked up ${pickup.amount} ${pickup.kind}.`);
      }
    }
  }

  private cleanupFarEntities() {
    if (this.mode !== "overworld") {
      return;
    }

    for (const enemy of [...this.enemies.values()]) {
      if (Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y) > ENEMY_DESPAWN_DISTANCE) {
        this.enemies.delete(enemy.id);
      }
    }
    for (const resource of [...this.resources.values()]) {
      if (Math.hypot(resource.x - this.player.x, resource.y - this.player.y) > RESOURCE_SPAWN_DISTANCE + 80) {
        this.resources.delete(resource.id);
      }
    }
    for (const pickup of [...this.pickups.values()]) {
      if (Math.hypot(pickup.x - this.player.x, pickup.y - this.player.y) > ENEMY_DESPAWN_DISTANCE) {
        this.pickups.delete(pickup.id);
      }
    }
  }

  private spawnNearby() {
    this.spawnEnemies();
    this.spawnResources();
  }

  private spawnEnemies() {
    if (this.enemies.size >= MAX_ENEMIES) {
      return;
    }

    if (this.mode === "overworld") {
      const tile = worldToTile(this.player.x, this.player.y);
      for (let cy = tile.y - 18; cy <= tile.y + 18; cy += 4) {
        for (let cx = tile.x - 18; cx <= tile.x + 18; cx += 4) {
          const id = `ow-e-${cx}:${cy}`;
          if (this.enemies.has(id) || (this.deadEnemies.get(id) ?? 0) > this.now) {
            continue;
          }
          if (rand01(this.seed + 503, cx, cy) < 0.76) {
            continue;
          }
          const position = tileToWorld(cx, cy);
          const dist = Math.hypot(position.x - this.player.x, position.y - this.player.y);
          if (dist < 72 || dist > ENEMY_SPAWN_DISTANCE) {
            continue;
          }
          const tileKind = getOverworldTile(this.seed, cx, cy);
          if (!isWalkableTile(tileKind) || tileKind === "entrance") {
            continue;
          }
          const kind: EnemyKind = rand01(this.seed + 509, cx, cy) > 0.82 ? "shade" : "slime";
          this.enemies.set(id, createEnemy(id, kind, position.x, position.y));
          if (this.enemies.size >= MAX_ENEMIES) {
            return;
          }
        }
      }
      return;
    }

    if (!this.dungeon) {
      return;
    }

    for (let ty = 2; ty < this.dungeon.height - 2; ty += 4) {
      for (let tx = 2; tx < this.dungeon.width - 2; tx += 4) {
        const id = `dg-e-${this.dungeon.key}-${tx}:${ty}`;
        if (this.enemies.has(id) || (this.deadEnemies.get(id) ?? 0) > this.now) {
          continue;
        }
        if (rand01(this.seed + 607, tx + this.tick, ty) < 0.82) {
          continue;
        }
        const index = ty * this.dungeon.width + tx;
        if (this.dungeon.tiles[index] !== "floor") {
          continue;
        }
        const position = tileToWorld(tx, ty);
        const dist = Math.hypot(position.x - this.player.x, position.y - this.player.y);
        if (dist < 96 || dist > 240) {
          continue;
        }
        const kind: EnemyKind = rand01(this.seed + 613, tx, ty) > 0.5 ? "shade" : "slime";
        this.enemies.set(id, createEnemy(id, kind, position.x, position.y, true));
        if (this.enemies.size >= MAX_ENEMIES) {
          return;
        }
      }
    }
  }

  private spawnResources() {
    if (this.resources.size >= MAX_RESOURCES) {
      return;
    }

    if (this.mode === "overworld") {
      const tile = worldToTile(this.player.x, this.player.y);
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
          if (this.resources.has(id) || (this.depletedResources.get(id) ?? 0) > this.now) {
            continue;
          }
          const position = tileToWorld(candidate.x, candidate.y);
          if (Math.hypot(position.x - this.player.x, position.y - this.player.y) > RESOURCE_SPAWN_DISTANCE) {
            continue;
          }
          this.resources.set(id, {
            id,
            kind: candidate.kind,
            x: position.x,
            y: position.y,
            hp: 1,
            maxHp: 1,
          });
          if (this.resources.size >= MAX_RESOURCES) {
            return;
          }
        }
      }
      return;
    }

    if (!this.dungeon) {
      return;
    }

    for (let ty = 4; ty < this.dungeon.height - 4; ty += 7) {
      for (let tx = 4; tx < this.dungeon.width - 4; tx += 7) {
        const id = `dg-r-${this.dungeon.key}-${tx}:${ty}`;
        if (this.resources.has(id) || (this.depletedResources.get(id) ?? 0) > this.now) {
          continue;
        }
        if (rand01(this.seed + 701, tx, ty) < 0.62) {
          continue;
        }
        const index = ty * this.dungeon.width + tx;
        if (this.dungeon.tiles[index] !== "floor") {
          continue;
        }
        const position = tileToWorld(tx, ty);
        if (Math.hypot(position.x - this.player.x, position.y - this.player.y) > 260) {
          continue;
        }
        this.resources.set(id, {
          id,
          kind: "essence",
          x: position.x,
          y: position.y,
          hp: 1,
          maxHp: 1,
        });
        if (this.resources.size >= MAX_RESOURCES) {
          return;
        }
      }
    }
  }

  private damageEnemy(id: string, amount: number): DamageResult {
    const enemy = this.enemies.get(id);
    if (!enemy) {
      return { killed: false };
    }

    enemy.hp -= amount;
    enemy.flash = 0.12;
    if (enemy.hp > 0) {
      return { killed: false };
    }

    this.enemies.delete(id);
    this.deadEnemies.set(id, this.now + (this.mode === "overworld" ? OVERWORLD_ENEMY_RESPAWN : DUNGEON_ENEMY_RESPAWN));
    this.rewardKill(enemy);
    return { killed: true };
  }

  private rewardKill(enemy: EnemyModel) {
    const xpGain = enemy.kind === "shade" ? 4 : 2;
    this.player.xp += xpGain;

    const amount = enemy.kind === "shade" ? 2 : 1;
    const kind: InventoryItem =
      enemy.kind === "shade"
        ? rand01(this.seed + this.tick, Math.floor(enemy.x), Math.floor(enemy.y)) > 0.55
          ? "ore"
          : "essence"
        : rand01(this.seed + this.tick + 1, Math.floor(enemy.x), Math.floor(enemy.y)) > 0.65
          ? "essence"
          : "wood";
    const dropId = `loot-${this.nextId++}`;
    this.pickups.set(dropId, {
      id: dropId,
      kind,
      x: enemy.x,
      y: enemy.y,
      amount,
    });
    this.pushMessage(`${capitalize(enemy.kind)} defeated. +${xpGain} XP.`);

    while (this.player.xp >= this.player.nextXp) {
      this.player.xp -= this.player.nextXp;
      this.player.level += 1;
      this.player.nextXp = 6 + this.player.level * 5;
      this.player.maxHp += 12;
      this.player.maxMana += 6;
      this.player.hp = this.player.maxHp;
      this.player.mana = this.player.maxMana;
      this.pushMessage(`Level up: ${this.player.level}.`);
    }
  }

  private craft(recipeId: string) {
    const recipe = RECIPES.find((entry) => entry.id === recipeId);
    if (!recipe) {
      return;
    }

    if (!this.player.alive) {
      return;
    }

    for (const [itemId, cost] of Object.entries(recipe.cost) as Array<[InventoryItem, number]>) {
      if (this.player.inventory[itemId] < cost) {
        this.pushMessage("Missing materials.");
        return;
      }
    }

    if ("weaponTier" in recipe.output && this.player.weaponTier >= recipe.output.weaponTier) {
      this.pushMessage("Weapon already upgraded.");
      return;
    }

    for (const [itemId, cost] of Object.entries(recipe.cost) as Array<[InventoryItem, number]>) {
      this.player.inventory[itemId] -= cost;
    }

    if ("itemId" in recipe.output) {
      this.player.inventory[recipe.output.itemId] += 1;
      this.pushMessage(`${recipe.name} crafted.`);
    } else {
      this.player.weaponTier = recipe.output.weaponTier;
      this.pushMessage(`${recipe.name} forged.`);
    }
  }

  private useItem(itemId: InventoryItem) {
    if (this.player.inventory[itemId] <= 0 || !this.player.alive) {
      return;
    }
    if (itemId === "potion") {
      this.player.inventory[itemId] -= 1;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
      this.pushMessage("Potion used.");
      return;
    }
    if (itemId === "ether") {
      this.player.inventory[itemId] -= 1;
      this.player.mana = Math.min(this.player.maxMana, this.player.mana + 25);
      this.pushMessage("Ether used.");
    }
  }

  private respawn() {
    if (this.player.alive) {
      return;
    }
    this.mode = "overworld";
    this.dungeon = null;
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.resources.clear();
    this.findSafeSpawn();
    this.player.alive = true;
    this.player.hp = this.player.maxHp;
    this.player.mana = this.player.maxMana;
    this.pushMessage("Respawned.");
  }

  private tryMove(x: number, y: number, dx: number, dy: number, radius: number) {
    const nextX = x + dx;
    const nextY = y + dy;
    const blockedX = this.collides(nextX, y, radius);
    const blockedY = this.collides(x, nextY, radius);
    return {
      x: blockedX ? x : nextX,
      y: blockedY ? y : nextY,
      blocked: blockedX || blockedY,
    };
  }

  private collides(x: number, y: number, radius: number) {
    const samples = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];
    for (const sample of samples) {
      const tile = this.getTileAt(sample.x, sample.y);
      if (!isWalkableTile(tile)) {
        return true;
      }
    }
    for (const resource of this.resources.values()) {
      if (Math.hypot(resource.x - x, resource.y - y) < radius + RESOURCE_RADIUS - 1) {
        return true;
      }
    }
    return false;
  }

  private getTileAt(x: number, y: number): TileKind {
    const tile = worldToTile(x, y);
    if (this.mode === "dungeon") {
      if (!this.dungeon) {
        return "void";
      }
      if (tile.x < 0 || tile.y < 0 || tile.x >= this.dungeon.width || tile.y >= this.dungeon.height) {
        return "void";
      }
      return this.dungeon.tiles[tile.y * this.dungeon.width + tile.x] ?? "void";
    }
    return getOverworldTile(this.seed, tile.x, tile.y);
  }

  private pushMessage(text: string) {
    this.messages.unshift({
      id: `msg-${this.nextId++}`,
      text,
      ttl: MESSAGE_TTL,
    });
    if (this.messages.length > 6) {
      this.messages.length = 6;
    }
  }
}

function createEnemy(id: string, kind: EnemyKind, x: number, y: number, empowered = false): EnemyModel {
  const maxHp = kind === "shade" ? 34 : 20;
  const damage = kind === "shade" ? 12 : 8;
  return {
    id,
    kind,
    x,
    y,
    hp: empowered ? Math.floor(maxHp * 1.25) : maxHp,
    maxHp: empowered ? Math.floor(maxHp * 1.25) : maxHp,
    flash: 0,
    vx: 0,
    vy: 0,
    damage: empowered ? damage + 2 : damage,
    cooldown: 0,
  };
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
