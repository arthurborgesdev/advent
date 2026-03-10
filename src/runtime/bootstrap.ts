import { GameApp } from "../game/app";

export function bootstrapGame(root: HTMLElement | null) {
  if (!root) {
    throw new Error("Missing #app root");
  }

  root.innerHTML = `
    <div class="shell">
      <div class="frame">
        <canvas id="game" width="960" height="640"></canvas>
      </div>
    </div>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) {
    throw new Error("Missing game canvas");
  }

  const app = new GameApp(canvas);
  app.start();
}
