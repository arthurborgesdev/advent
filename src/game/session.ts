import type {
  ClientCommand,
  ClientPacket,
  InventoryItem,
  ServerPacket,
  ServerSnapshot,
  SessionTransport,
} from "./protocol";
import { GameSimulation } from "./simulation";

const REMOTE_PORT = 2567;
const REMOTE_PATH = "/ws";

export class LocalSession implements SessionTransport {
  private readonly simulation = new GameSimulation();
  private readonly playerId = this.simulation.addPlayer("You");

  update(dt: number) {
    this.simulation.update(dt);
  }

  send(command: ClientCommand) {
    this.simulation.handleCommand(this.playerId, command);
  }

  getSnapshot(): ServerSnapshot {
    return this.simulation.getSnapshot(this.playerId, "local");
  }

  dispose() {}
}

export class AutoSession implements SessionTransport {
  private readonly remoteUrl: string;
  private readonly queued: ClientCommand[] = [];
  private readonly fallback = new LocalSession();
  private websocket: WebSocket | null = null;
  private snapshot = createPlaceholderSnapshot("connecting");
  private usingFallback = false;
  private connected = false;
  private everConnected = false;
  private elapsed = 0;

  constructor() {
    this.remoteUrl = buildServerUrl();
    this.connect();
  }

  update(dt: number) {
    this.elapsed += dt;
    if (this.usingFallback) {
      this.fallback.update(dt);
      return;
    }

    if (!this.connected && !this.everConnected && this.elapsed > 1.1) {
      this.activateFallback();
    }
  }

  send(command: ClientCommand) {
    if (this.usingFallback) {
      this.fallback.send(command);
      return;
    }

    if (!this.connected || !this.websocket) {
      this.queued.push(command);
      return;
    }

    const packet: ClientPacket = {
      type: "command",
      command,
    };
    this.websocket.send(JSON.stringify(packet));
  }

  getSnapshot() {
    if (this.usingFallback) {
      return this.fallback.getSnapshot();
    }
    return this.snapshot;
  }

  dispose() {
    this.websocket?.close();
    this.fallback.dispose();
  }

  private connect() {
    const socket = new WebSocket(this.remoteUrl);
    this.websocket = socket;

    socket.addEventListener("open", () => {
      this.connected = true;
      this.everConnected = true;
      this.snapshot = {
        ...this.snapshot,
        connection: "online",
      };
      for (const command of this.queued.splice(0)) {
        this.send(command);
      }
    });

    socket.addEventListener("message", (event) => {
      const packet = JSON.parse(String(event.data)) as ServerPacket;
      if (packet.type !== "snapshot") {
        return;
      }
      this.snapshot = {
        ...packet.snapshot,
        connection: this.connected ? "online" : "connecting",
      };
    });

    socket.addEventListener("error", () => {
      if (!this.everConnected) {
        this.activateFallback();
      }
    });

    socket.addEventListener("close", () => {
      this.connected = false;
      if (!this.everConnected) {
        this.activateFallback();
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        connection: "offline",
      };
    });
  }

  private activateFallback() {
    if (this.usingFallback) {
      return;
    }
    this.usingFallback = true;
    this.websocket?.close();
  }
}

function buildServerUrl() {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("server");
  if (forced) {
    return forced;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "127.0.0.1";
  const name = params.get("name") ?? randomName();
  const port =
    window.location.port === String(REMOTE_PORT) || (window.location.port === "" && host !== "127.0.0.1")
      ? window.location.port
      : host === "127.0.0.1" || host === "localhost"
        ? String(REMOTE_PORT)
        : window.location.port;
  const authority = port ? `${host}:${port}` : host;
  return `${protocol}//${authority}${REMOTE_PATH}?name=${encodeURIComponent(name)}`;
}

function randomName() {
  return `Wanderer-${Math.floor(Math.random() * 900 + 100)}`;
}

function createPlaceholderSnapshot(connection: "connecting" | "offline"): ServerSnapshot {
  const inventory: Record<InventoryItem, number> = {
    wood: 0,
    ore: 0,
    essence: 0,
    potion: 0,
    ether: 0,
  };
  return {
    tick: 0,
    seed: 0,
    connection,
    areaId: "boot",
    mode: "overworld",
    onlinePlayers: 1,
    playerId: "boot",
    player: {
      id: "boot",
      name: "Connecting",
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
      inventory,
      alive: true,
      attackCooldown: 0,
      castCooldown: 0,
      interactCooldown: 0,
    },
    players: [],
    enemies: [],
    projectiles: [],
    pickups: [],
    resources: [],
    attackEffects: [],
    dungeon: null,
    messages: [],
  };
}
