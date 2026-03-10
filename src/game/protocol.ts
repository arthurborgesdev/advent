export type Vec2 = { x: number; y: number };

export type Facing = "up" | "down" | "left" | "right";

export type TileKind =
  | "grass"
  | "water"
  | "stone"
  | "floor"
  | "wall"
  | "entrance"
  | "void";

export type WorldMode = "overworld" | "dungeon";

export type ResourceKind = "wood" | "ore" | "essence";
export type InventoryItem = ResourceKind | "potion" | "ether";
export type EnemyKind = "slime" | "shade";
export type ProjectileKind = "bolt";

export type PlayerIntent = {
  moveX: number;
  moveY: number;
  attack: boolean;
  cast: boolean;
  interact: boolean;
};

export type ClientCommand =
  | { type: "set-intent"; intent: PlayerIntent }
  | { type: "craft"; recipeId: string }
  | { type: "use-item"; itemId: InventoryItem }
  | { type: "respawn" };

export type MessageEntry = {
  id: string;
  text: string;
  ttl: number;
};

export type PlayerSnapshot = {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  level: number;
  xp: number;
  nextXp: number;
  facing: Facing;
  weaponTier: number;
  inventory: Record<InventoryItem, number>;
  alive: boolean;
  attackCooldown: number;
  castCooldown: number;
  interactCooldown: number;
};

export type EnemySnapshot = {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  flash: number;
};

export type ProjectileSnapshot = {
  id: string;
  kind: ProjectileKind;
  x: number;
  y: number;
  ttl: number;
};

export type PickupSnapshot = {
  id: string;
  kind: InventoryItem;
  x: number;
  y: number;
  amount: number;
};

export type ResourceSnapshot = {
  id: string;
  kind: ResourceKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
};

export type AttackEffectSnapshot = {
  x: number;
  y: number;
  dir: Facing;
  ttl: number;
};

export type DungeonSnapshot = {
  key: string;
  width: number;
  height: number;
  tiles: TileKind[];
  spawn: Vec2;
  exit: Vec2;
};

export type ServerSnapshot = {
  tick: number;
  seed: number;
  mode: WorldMode;
  playerId: string;
  player: PlayerSnapshot;
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  pickups: PickupSnapshot[];
  resources: ResourceSnapshot[];
  attackEffects: AttackEffectSnapshot[];
  dungeon: DungeonSnapshot | null;
  messages: MessageEntry[];
};

export type Recipe = {
  id: string;
  name: string;
  description: string;
  cost: Partial<Record<InventoryItem, number>>;
  output: { itemId: InventoryItem } | { weaponTier: number };
};

export interface SessionTransport {
  update(dt: number): void;
  send(command: ClientCommand): void;
  getSnapshot(): ServerSnapshot;
}
