import { OVERWORLD_SECTOR_SIZE, TILE_SIZE } from "./config";
import type { DungeonSnapshot, ResourceKind, TileKind, Vec2 } from "./protocol";
import { hash2d, makeSequence, rand01, valueNoise } from "./random";

export function tileToWorld(tx: number, ty: number): Vec2 {
  return {
    x: tx * TILE_SIZE + TILE_SIZE / 2,
    y: ty * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function worldToTile(x: number, y: number): Vec2 {
  return {
    x: Math.floor(x / TILE_SIZE),
    y: Math.floor(y / TILE_SIZE),
  };
}

export function getOverworldTile(seed: number, tx: number, ty: number): TileKind {
  const moisture = valueNoise(seed + 11, tx, ty, 9);
  const height = valueNoise(seed + 29, tx, ty, 16);
  const stone = valueNoise(seed + 47, tx, ty, 5);
  const entrance = getDungeonEntrance(seed, tx, ty);

  if (entrance && entrance.x === tx && entrance.y === ty) {
    return "entrance";
  }
  if (height < 0.18 || (height < 0.25 && moisture > 0.62)) {
    return "water";
  }
  if (stone > 0.75) {
    return "stone";
  }
  return "grass";
}

export function isWalkableTile(tile: TileKind) {
  return tile !== "water" && tile !== "wall" && tile !== "void";
}

export function getDungeonEntrance(seed: number, tx: number, ty: number) {
  const sx = Math.floor(tx / OVERWORLD_SECTOR_SIZE);
  const sy = Math.floor(ty / OVERWORLD_SECTOR_SIZE);
  const sectorSeed = hash2d(seed + 101, sx, sy);
  const offsetX = (sectorSeed % 18) - 9;
  const offsetY = (Math.floor(sectorSeed / 37) % 18) - 9;
  const cx = sx * OVERWORLD_SECTOR_SIZE + Math.floor(OVERWORLD_SECTOR_SIZE / 2) + offsetX;
  const cy = sy * OVERWORLD_SECTOR_SIZE + Math.floor(OVERWORLD_SECTOR_SIZE / 2) + offsetY;

  if (rand01(seed + 131, sx, sy) < 0.22) {
    return { x: cx, y: cy, key: `${sx}:${sy}` };
  }
  return null;
}

export function getResourceCandidate(
  seed: number,
  rx: number,
  ry: number,
): { x: number; y: number; kind: ResourceKind } | null {
  const roll = rand01(seed + 211, rx, ry);
  if (roll < 0.28) {
    return null;
  }

  const baseX = rx * 6 + (hash2d(seed + 223, rx, ry) % 6);
  const baseY = ry * 6 + (hash2d(seed + 227, ry, rx) % 6);
  const tile = getOverworldTile(seed, baseX, baseY);
  if (!isWalkableTile(tile) || tile === "entrance") {
    return null;
  }

  let kind: ResourceKind = "wood";
  if (tile === "stone") {
    kind = "ore";
  } else if (roll > 0.86) {
    kind = "essence";
  }

  return { x: baseX, y: baseY, kind };
}

export function buildDungeon(seed: number, key: string): DungeonSnapshot {
  const [sx, sy] = key.split(":").map((part) => Number.parseInt(part, 10));
  const dungeonSeed = hash2d(seed + 401, sx, sy);
  const rng = makeSequence(dungeonSeed);
  const width = 48;
  const height = 48;
  const tiles = new Array<TileKind>(width * height).fill("wall");
  const rooms: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (let i = 0; i < 8; i += 1) {
    const w = 5 + Math.floor(rng() * 8);
    const h = 5 + Math.floor(rng() * 8);
    const x = 2 + Math.floor(rng() * (width - w - 4));
    const y = 2 + Math.floor(rng() * (height - h - 4));
    rooms.push({ x, y, w, h });
    carveRoom(tiles, width, height, x, y, w, h);
  }

  for (let i = 1; i < rooms.length; i += 1) {
    const a = centerOfRoom(rooms[i - 1]!);
    const b = centerOfRoom(rooms[i]!);
    carveCorridor(tiles, width, height, a.x, a.y, b.x, b.y);
  }

  const spawn = centerOfRoom(rooms[0]!);
  const exit = centerOfRoom(rooms[rooms.length - 1]!);
  setTile(tiles, width, spawn.x, spawn.y, "entrance");
  setTile(tiles, width, exit.x, exit.y, "floor");

  return {
    key,
    width,
    height,
    tiles,
    spawn: tileToWorld(spawn.x, spawn.y),
    exit: tileToWorld(exit.x, exit.y),
  };
}

function carveRoom(
  tiles: TileKind[],
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      if (xx > 0 && yy > 0 && xx < width - 1 && yy < height - 1) {
        setTile(tiles, width, xx, yy, "floor");
      }
    }
  }
}

function carveCorridor(
  tiles: TileKind[],
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  let x = ax;
  let y = ay;

  while (x !== bx) {
    setTile(tiles, width, x, y, "floor");
    x += x < bx ? 1 : -1;
  }
  while (y !== by) {
    setTile(tiles, width, x, y, "floor");
    y += y < by ? 1 : -1;
  }
  setTile(tiles, width, x, y, "floor");
  for (let yy = -1; yy <= 1; yy += 1) {
    for (let xx = -1; xx <= 1; xx += 1) {
      const px = x + xx;
      const py = y + yy;
      if (px >= 0 && py >= 0 && px < width && py < height && tiles[py * width + px] === "wall") {
        setTile(tiles, width, px, py, rand01(width * height, px, py) > 0.6 ? "wall" : "floor");
      }
    }
  }
}

function centerOfRoom(room: { x: number; y: number; w: number; h: number }) {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

function setTile(tiles: TileKind[], width: number, x: number, y: number, tile: TileKind) {
  tiles[y * width + x] = tile;
}
