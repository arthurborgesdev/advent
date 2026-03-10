import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE, CAMERA_LERP } from "./config";
import { ITEM_LABELS, RECIPES } from "./data";
import type { InventoryItem, ServerSnapshot } from "./protocol";
import { getOverworldTile, worldToTile } from "./worldgen";

export type UIState = {
  inventoryOpen: boolean;
  craftOpen: boolean;
};

export type UIButton = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cameraX = 0;
  private cameraY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.font = '12px "Courier New", monospace';
    this.ctx.textBaseline = "top";
  }

  render(snapshot: ServerSnapshot, ui: UIState, mouse: { x: number; y: number }) {
    this.cameraX += (snapshot.player.x - this.cameraX) * CAMERA_LERP;
    this.cameraY += (snapshot.player.y - this.cameraY) * CAMERA_LERP;

    const buttons: UIButton[] = [];
    this.ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.drawWorld(snapshot);
    this.drawResources(snapshot);
    this.drawPickups(snapshot);
    this.drawProjectiles(snapshot);
    this.drawAttackEffects(snapshot);
    this.drawEnemies(snapshot);
    this.drawPlayer(snapshot);
    this.drawHud(snapshot, ui, buttons, mouse);
    return buttons;
  }

  private drawWorld(snapshot: ServerSnapshot) {
    const tilesWide = Math.ceil(GAME_WIDTH / TILE_SIZE) + 2;
    const tilesHigh = Math.ceil(GAME_HEIGHT / TILE_SIZE) + 2;
    const origin = worldToTile(this.cameraX - GAME_WIDTH / 2, this.cameraY - GAME_HEIGHT / 2);

    for (let yy = 0; yy <= tilesHigh; yy += 1) {
      for (let xx = 0; xx <= tilesWide; xx += 1) {
        const tx = origin.x + xx;
        const ty = origin.y + yy;
        const tile =
          snapshot.mode === "overworld"
            ? getOverworldTile(snapshot.seed, tx, ty)
            : snapshot.dungeon?.tiles[ty * (snapshot.dungeon?.width ?? 0) + tx] ?? "void";
        const px = tx * TILE_SIZE - this.cameraX + GAME_WIDTH / 2;
        const py = ty * TILE_SIZE - this.cameraY + GAME_HEIGHT / 2;
        this.drawTile(tile, px, py);
      }
    }
  }

  private drawTile(tile: string, px: number, py: number) {
    const ctx = this.ctx;
    if (tile === "void") {
      ctx.fillStyle = "#010101";
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      return;
    }

    const base =
      tile === "grass"
        ? "#101010"
        : tile === "stone"
          ? "#272727"
          : tile === "water"
            ? "#050505"
            : tile === "wall"
              ? "#4a4a4a"
              : tile === "entrance"
                ? "#f4f4f4"
                : "#141414";
    ctx.fillStyle = base;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    ctx.fillStyle = "#d9d9d9";
    if (tile === "grass") {
      ctx.fillRect(px + 2, py + 2, 1, 1);
      ctx.fillRect(px + 9, py + 11, 1, 1);
    } else if (tile === "stone") {
      ctx.fillRect(px + 3, py + 4, 7, 1);
      ctx.fillRect(px + 10, py + 10, 3, 1);
    } else if (tile === "water") {
      ctx.fillRect(px + 1, py + 6, 5, 1);
      ctx.fillRect(px + 8, py + 10, 4, 1);
    } else if (tile === "wall") {
      ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 2);
      ctx.fillRect(px + 2, py + 7, TILE_SIZE - 4, 2);
    } else if (tile === "entrance") {
      ctx.fillStyle = "#000";
      ctx.fillRect(px + 4, py + 4, 8, 8);
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(px + 2.5, py + 2.5, 11, 11);
    }
  }

  private drawResources(snapshot: ServerSnapshot) {
    for (const resource of snapshot.resources) {
      const pos = this.toScreen(resource.x, resource.y);
      if (resource.kind === "wood") {
        this.ctx.fillStyle = "#f0f0f0";
        this.ctx.fillRect(pos.x - 4, pos.y - 5, 8, 10);
        this.ctx.fillStyle = "#000";
        this.ctx.fillRect(pos.x - 1, pos.y - 2, 2, 7);
      } else if (resource.kind === "ore") {
        this.ctx.fillStyle = "#b8b8b8";
        this.ctx.fillRect(pos.x - 5, pos.y - 4, 10, 8);
        this.ctx.fillStyle = "#fff";
        this.ctx.fillRect(pos.x - 2, pos.y - 2, 2, 2);
      } else {
        this.ctx.fillStyle = "#fff";
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y - 6);
        this.ctx.lineTo(pos.x + 4, pos.y);
        this.ctx.lineTo(pos.x, pos.y + 6);
        this.ctx.lineTo(pos.x - 4, pos.y);
        this.ctx.closePath();
        this.ctx.fill();
      }
    }
  }

  private drawPickups(snapshot: ServerSnapshot) {
    for (const pickup of snapshot.pickups) {
      const pos = this.toScreen(pickup.x, pickup.y);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillRect(pos.x - 3, pos.y - 3, 6, 6);
      this.ctx.fillStyle = "#000";
      this.ctx.fillText(String(pickup.amount), pos.x + 6, pos.y - 6);
    }
  }

  private drawProjectiles(snapshot: ServerSnapshot) {
    this.ctx.fillStyle = "#fff";
    for (const projectile of snapshot.projectiles) {
      const pos = this.toScreen(projectile.x, projectile.y);
      this.ctx.fillRect(pos.x - 2, pos.y - 2, 4, 4);
    }
  }

  private drawAttackEffects(snapshot: ServerSnapshot) {
    this.ctx.fillStyle = "#fff";
    for (const slash of snapshot.attackEffects) {
      const pos = this.toScreen(slash.x, slash.y);
      const w = slash.dir === "left" || slash.dir === "right" ? 18 : 8;
      const h = slash.dir === "up" || slash.dir === "down" ? 18 : 8;
      this.ctx.globalAlpha = Math.max(0.2, slash.ttl * 4);
      this.ctx.fillRect(pos.x - w / 2, pos.y - h / 2, w, h);
      this.ctx.globalAlpha = 1;
    }
  }

  private drawEnemies(snapshot: ServerSnapshot) {
    for (const enemy of snapshot.enemies) {
      const pos = this.toScreen(enemy.x, enemy.y);
      this.ctx.fillStyle = enemy.flash > 0 ? "#fff" : enemy.kind === "shade" ? "#c4c4c4" : "#9f9f9f";
      if (enemy.kind === "slime") {
        this.ctx.fillRect(pos.x - 6, pos.y - 4, 12, 8);
      } else {
        this.ctx.fillRect(pos.x - 5, pos.y - 6, 10, 12);
        this.ctx.fillStyle = "#000";
        this.ctx.fillRect(pos.x - 2, pos.y - 2, 1, 1);
        this.ctx.fillRect(pos.x + 1, pos.y - 2, 1, 1);
      }
      this.ctx.fillStyle = "#fff";
      this.ctx.fillRect(pos.x - 8, pos.y - 12, 16, 2);
      this.ctx.fillStyle = "#000";
      this.ctx.fillRect(pos.x - 8, pos.y - 12, 16, 2);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillRect(pos.x - 8, pos.y - 12, (enemy.hp / enemy.maxHp) * 16, 2);
    }
  }

  private drawPlayer(snapshot: ServerSnapshot) {
    const pos = this.toScreen(snapshot.player.x, snapshot.player.y);
    this.ctx.fillStyle = snapshot.player.alive ? "#fff" : "#888";
    this.ctx.fillRect(pos.x - 5, pos.y - 6, 10, 12);
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(pos.x - 2, pos.y - 2, 1, 1);
    this.ctx.fillRect(pos.x + 1, pos.y - 2, 1, 1);

    const hand =
      snapshot.player.facing === "left"
        ? { x: -8, y: 1 }
        : snapshot.player.facing === "right"
          ? { x: 8, y: 1 }
          : snapshot.player.facing === "up"
            ? { x: 0, y: -9 }
            : { x: 0, y: 9 };
    this.ctx.fillStyle = "#d9d9d9";
    this.ctx.fillRect(pos.x + hand.x - 2, pos.y + hand.y - 2, 4, 4);
  }

  private drawHud(
    snapshot: ServerSnapshot,
    ui: UIState,
    buttons: UIButton[],
    mouse: { x: number; y: number },
  ) {
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    this.ctx.fillRect(12, 12, 310, 100);
    this.ctx.strokeStyle = "#fff";
    this.ctx.strokeRect(12.5, 12.5, 310, 100);

    this.drawBar(24, 26, 160, 12, snapshot.player.hp / snapshot.player.maxHp, "HP");
    this.drawBar(24, 46, 160, 12, snapshot.player.mana / snapshot.player.maxMana, "MP");
    this.drawBar(24, 66, 160, 12, snapshot.player.xp / snapshot.player.nextXp, "XP");

    this.ctx.fillStyle = "#fff";
    this.ctx.fillText(`LV ${snapshot.player.level}`, 200, 26);
    this.ctx.fillText(`Sword ${snapshot.player.weaponTier}`, 200, 46);
    this.ctx.fillText(snapshot.mode === "overworld" ? "Overworld" : `Dungeon ${snapshot.dungeon?.key ?? ""}`, 200, 66);

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    this.ctx.fillRect(GAME_WIDTH - 272, 12, 248, 118);
    this.ctx.strokeStyle = "#fff";
    this.ctx.strokeRect(GAME_WIDTH - 271.5, 12.5, 248, 118);
    this.ctx.fillStyle = "#fff";
    this.ctx.fillText("WASD move  SPACE sword  F magic", GAME_WIDTH - 260, 24);
    this.ctx.fillText("E interact  I inventory  C crafting", GAME_WIDTH - 260, 42);
    this.ctx.fillText("Mouse clicks buttons in menus", GAME_WIDTH - 260, 60);
    this.ctx.fillText("R respawn when dead", GAME_WIDTH - 260, 78);

    const inventoryTab = this.drawButton(buttons, "toggle-inventory", 24, GAME_HEIGHT - 52, 122, 28, `[I] Inventory`, mouse);
    const craftTab = this.drawButton(buttons, "toggle-craft", 154, GAME_HEIGHT - 52, 122, 28, `[C] Crafting`, mouse);
    if (ui.inventoryOpen) {
      this.drawInventoryPanel(snapshot, buttons, mouse);
    }
    if (ui.craftOpen) {
      this.drawCraftPanel(snapshot, buttons, mouse);
    }

    if (inventoryTab || craftTab) {
      this.canvas.style.cursor = "pointer";
    } else if (!ui.inventoryOpen && !ui.craftOpen) {
      this.canvas.style.cursor = "crosshair";
    }

    let messageY = GAME_HEIGHT - 140;
    for (const message of snapshot.messages) {
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      this.ctx.fillRect(24, messageY, 310, 18);
      this.ctx.strokeStyle = "#fff";
      this.ctx.strokeRect(24.5, messageY + 0.5, 310, 18);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillText(message.text, 32, messageY + 3);
      messageY -= 22;
    }

    if (!snapshot.player.alive) {
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.86)";
      this.ctx.fillRect(250, 248, 460, 112);
      this.ctx.strokeStyle = "#fff";
      this.ctx.strokeRect(250.5, 248.5, 460, 112);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillText("YOU DIED", 445, 276);
      this.ctx.fillText("Press R to respawn in the overworld.", 340, 302);
    }
  }

  private drawInventoryPanel(
    snapshot: ServerSnapshot,
    buttons: UIButton[],
    mouse: { x: number; y: number },
  ) {
    const x = GAME_WIDTH - 280;
    const y = 148;
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
    this.ctx.fillRect(x, y, 248, 188);
    this.ctx.strokeStyle = "#fff";
    this.ctx.strokeRect(x + 0.5, y + 0.5, 248, 188);
    this.ctx.fillStyle = "#fff";
    this.ctx.fillText("Inventory", x + 12, y + 12);

    const items: InventoryItem[] = ["wood", "ore", "essence", "potion", "ether"];
    let rowY = y + 34;
    let hover = false;
    for (const itemId of items) {
      this.ctx.fillText(`${ITEM_LABELS[itemId]}: ${snapshot.player.inventory[itemId]}`, x + 12, rowY);
      if (itemId === "potion" || itemId === "ether") {
        hover = this.drawButton(buttons, `use-${itemId}`, x + 138, rowY - 2, 84, 20, "Use", mouse) || hover;
      }
      rowY += 28;
    }
    if (hover) {
      this.canvas.style.cursor = "pointer";
    }
  }

  private drawCraftPanel(
    snapshot: ServerSnapshot,
    buttons: UIButton[],
    mouse: { x: number; y: number },
  ) {
    const x = 24;
    const y = 126;
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
    this.ctx.fillRect(x, y, 330, 220);
    this.ctx.strokeStyle = "#fff";
    this.ctx.strokeRect(x + 0.5, y + 0.5, 330, 220);
    this.ctx.fillStyle = "#fff";
    this.ctx.fillText("Crafting", x + 12, y + 12);
    let rowY = y + 34;
    let hover = false;
    for (const recipe of RECIPES) {
      const cost = Object.entries(recipe.cost)
        .map(([itemId, amount]) => `${amount} ${ITEM_LABELS[itemId as InventoryItem]}`)
        .join(", ");
      const owned = Object.entries(recipe.cost).every(([itemId, amount]) => snapshot.player.inventory[itemId as InventoryItem] >= amount);
      this.ctx.fillStyle = "#fff";
      this.ctx.fillText(recipe.name, x + 12, rowY);
      this.ctx.fillStyle = "#bdbdbd";
      this.ctx.fillText(cost, x + 12, rowY + 12);
      this.ctx.fillStyle = "#9f9f9f";
      this.ctx.fillText(recipe.description, x + 12, rowY + 24);
      hover = this.drawButton(
        buttons,
        `craft-${recipe.id}`,
        x + 232,
        rowY + 8,
        82,
        24,
        owned ? "Craft" : "Need",
        mouse,
        owned,
      ) || hover;
      rowY += 48;
    }
    if (hover) {
      this.canvas.style.cursor = "pointer";
    }
  }

  private drawButton(
    buttons: UIButton[],
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    mouse: { x: number; y: number },
    enabled = true,
  ) {
    const hovered = enabled && mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
    buttons.push({ id, x, y, w, h });
    this.ctx.fillStyle = !enabled ? "#181818" : hovered ? "#fff" : "#111";
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeStyle = "#fff";
    this.ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.ctx.fillStyle = !enabled ? "#555" : hovered ? "#000" : "#fff";
    this.ctx.fillText(label, x + 12, y + 6);
    return hovered;
  }

  private drawBar(x: number, y: number, w: number, h: number, fill: number, label: string) {
    this.ctx.fillStyle = "#111";
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeStyle = "#fff";
    this.ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * fill), h - 2);
    this.ctx.fillStyle = "#000";
    this.ctx.fillText(label, x + 6, y + 1);
  }

  private toScreen(x: number, y: number) {
    return {
      x: x - this.cameraX + GAME_WIDTH / 2,
      y: y - this.cameraY + GAME_HEIGHT / 2,
    };
  }
}
