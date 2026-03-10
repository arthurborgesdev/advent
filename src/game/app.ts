import { GAME_HEIGHT, GAME_WIDTH } from "./config";
import { InputController } from "./input";
import type { ClientCommand } from "./protocol";
import { GameRenderer, type UIState } from "./render";
import { LocalSession } from "./session";

export class GameApp {
  private readonly input: InputController;
  private readonly renderer: GameRenderer;
  private readonly session = new LocalSession();
  private readonly ui: UIState = {
    inventoryOpen: false,
    craftOpen: false,
  };
  private raf = 0;
  private lastTime = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;
    this.input = new InputController(canvas);
    this.renderer = new GameRenderer(canvas);
  }

  start() {
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.dispose();
  }

  private frame = (time: number) => {
    const dt = this.lastTime === 0 ? 1 / 60 : (time - this.lastTime) / 1000;
    this.lastTime = time;

    this.handleUiToggles();
    this.sendIntent();
    this.session.update(dt);
    const snapshot = this.session.getSnapshot();
    const buttons = this.renderer.render(snapshot, this.ui, this.input.getMouse());
    this.handleMouse(buttons);
    this.input.endFrame();
    this.raf = requestAnimationFrame(this.frame);
  };

  private handleUiToggles() {
    if (this.input.consumePressed("KeyI")) {
      this.ui.inventoryOpen = !this.ui.inventoryOpen;
      if (this.ui.inventoryOpen) {
        this.ui.craftOpen = false;
      }
    }
    if (this.input.consumePressed("KeyC")) {
      this.ui.craftOpen = !this.ui.craftOpen;
      if (this.ui.craftOpen) {
        this.ui.inventoryOpen = false;
      }
    }
    if (this.input.consumePressed("Escape")) {
      this.ui.inventoryOpen = false;
      this.ui.craftOpen = false;
    }
    if (this.input.consumePressed("KeyR")) {
      this.session.send({ type: "respawn" });
    }
  }

  private sendIntent() {
    const moveX = Number(this.input.isDown("KeyD")) - Number(this.input.isDown("KeyA"));
    const moveY = Number(this.input.isDown("KeyS")) - Number(this.input.isDown("KeyW"));
    const command: ClientCommand = {
      type: "set-intent",
      intent: {
        moveX,
        moveY,
        attack: this.input.isDown("Space"),
        cast: this.input.isDown("KeyF"),
        interact: this.input.isDown("KeyE"),
      },
    };
    this.session.send(command);
  }

  private handleMouse(buttons: Array<{ id: string; x: number; y: number; w: number; h: number }>) {
    if (!this.input.consumeMousePressed()) {
      return;
    }
    const mouse = this.input.getMouse();
    const hit = buttons.find(
      (button) =>
        mouse.x >= button.x &&
        mouse.x <= button.x + button.w &&
        mouse.y >= button.y &&
        mouse.y <= button.y + button.h,
    );
    if (!hit) {
      return;
    }

    if (hit.id === "toggle-inventory") {
      this.ui.inventoryOpen = !this.ui.inventoryOpen;
      if (this.ui.inventoryOpen) {
        this.ui.craftOpen = false;
      }
      return;
    }
    if (hit.id === "toggle-craft") {
      this.ui.craftOpen = !this.ui.craftOpen;
      if (this.ui.craftOpen) {
        this.ui.inventoryOpen = false;
      }
      return;
    }
    if (hit.id.startsWith("use-")) {
      this.session.send({
        type: "use-item",
        itemId: hit.id.replace("use-", "") as "potion" | "ether",
      });
      return;
    }
    if (hit.id.startsWith("craft-")) {
      this.session.send({
        type: "craft",
        recipeId: hit.id.replace("craft-", ""),
      });
    }
  }
}
