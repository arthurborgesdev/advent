import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientPacket } from "../src/game/protocol";
import { GameSimulation } from "../src/game/simulation";

const port = Number.parseInt(process.env.PORT ?? "2567", 10);
const tickRateMs = 1000 / 30;
const websocketPath = "/ws";
const distRoot = join(process.cwd(), "dist");

const simulation = new GameSimulation();
const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (method === "GET" && url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (method !== "GET" || url.pathname === websocketPath) {
    response.writeHead(404);
    response.end("not found");
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeJoin(distRoot, requestedPath);
  if (!filePath) {
    response.writeHead(400);
    response.end("bad request");
    return;
  }

  const candidate = existsSync(filePath) ? filePath : join(distRoot, "index.html");
  if (!existsSync(candidate)) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("dist not built");
    return;
  }

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentType(candidate),
      "cache-control": candidate.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(candidate).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

const wss = new WebSocketServer({
  server,
  path: websocketPath,
});

const clients = new Map<
  WebSocket,
  {
    playerId: string;
    alive: boolean;
  }
>();

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const name = sanitizeName(url.searchParams.get("name"));
  const playerId = simulation.addPlayer(name);
  clients.set(socket, { playerId, alive: true });

  socket.on("pong", () => {
    const client = clients.get(socket);
    if (client) {
      client.alive = true;
    }
  });

  socket.on("message", (buffer: Buffer) => {
    try {
      const packet = JSON.parse(buffer.toString()) as ClientPacket;
      if (packet.type === "command") {
        simulation.handleCommand(playerId, packet.command);
      }
    } catch {
      socket.close(1003, "Invalid payload");
    }
  });

  socket.on("close", () => {
    simulation.removePlayer(playerId);
    clients.delete(socket);
  });
});

const simulationInterval = setInterval(() => {
  simulation.update(1 / 30);
  for (const [socket, client] of clients.entries()) {
    if (socket.readyState !== socket.OPEN) {
      continue;
    }
    socket.send(
      JSON.stringify({
        type: "snapshot",
        snapshot: simulation.getSnapshot(client.playerId, "online"),
      }),
    );
  }
}, tickRateMs);

const heartbeatInterval = setInterval(() => {
  for (const [socket, client] of clients.entries()) {
    if (socket.readyState !== socket.OPEN) {
      continue;
    }
    if (!client.alive) {
      socket.terminate();
      continue;
    }
    client.alive = false;
    socket.ping();
  }
}, 15000);

server.listen(port, "0.0.0.0", () => {
  console.log(`Advent listening on http://0.0.0.0:${port}`);
  console.log(`WebSocket endpoint path ${websocketPath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(simulationInterval);
    clearInterval(heartbeatInterval);
    for (const socket of clients.keys()) {
      socket.close(1001, "Server shutting down");
    }
    wss.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  });
}

function sanitizeName(value: string | null) {
  if (!value) {
    return "";
  }
  return value.replace(/[^a-zA-Z0-9 -]/g, "").trim().slice(0, 18);
}

function safeJoin(root: string, pathName: string) {
  const candidate = normalize(join(root, pathName));
  if (!candidate.startsWith(root)) {
    return null;
  }
  return candidate;
}

function contentType(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".ico") {
    return "image/x-icon";
  }
  return "application/octet-stream";
}
