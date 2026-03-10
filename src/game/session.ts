import type { ClientCommand, ServerSnapshot, SessionTransport } from "./protocol";
import { GameSimulation } from "./simulation";

export class LocalSession implements SessionTransport {
  private readonly simulation = new GameSimulation();

  update(dt: number) {
    this.simulation.update(dt);
  }

  send(command: ClientCommand) {
    this.simulation.handleCommand(command);
  }

  getSnapshot(): ServerSnapshot {
    return this.simulation.getSnapshot();
  }
}
