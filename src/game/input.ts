type MouseState = {
  x: number;
  y: number;
  down: boolean;
  pressed: boolean;
};

export class InputController {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly mouse: MouseState = {
    x: 0,
    y: 0,
    down: false,
    pressed: false,
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  consumePressed(code: string) {
    const has = this.pressed.has(code);
    this.pressed.delete(code);
    return has;
  }

  consumeMousePressed() {
    const pressed = this.mouse.pressed;
    this.mouse.pressed = false;
    return pressed;
  }

  getMouse() {
    return { ...this.mouse };
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.pressed = false;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.down.has(event.code)) {
      this.pressed.add(event.code);
    }
    this.down.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.down.delete(event.code);
  };

  private onBlur = () => {
    this.down.clear();
    this.pressed.clear();
    this.mouse.down = false;
    this.mouse.pressed = false;
  };

  private onMouseMove = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * this.canvas.width;
    this.mouse.y = ((event.clientY - rect.top) / rect.height) * this.canvas.height;
  };

  private onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    this.onMouseMove(event);
    this.mouse.down = true;
    this.mouse.pressed = true;
  };

  private onMouseUp = () => {
    this.mouse.down = false;
  };
}
