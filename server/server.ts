import { createServer } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientPacket } from "../src/game/protocol";
import { GameSimulation } from "../src/game/simulation";

const port = Number.parseInt(process.env.PORT ?? "2567", 10);
const tickRate = 1000 / 30;

const simulation = new GameSimulation();
const server = createServer();
const wss = new WebSocketServer({ server });
const clients = new Map<WebSocket, { playerId: string }>();

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const name = sanitizeName(url.searchParams.get("name"));
  const playerId = simulation.addPlayer(name);
  clients.set(socket, { playerId });

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

setInterval(() => {
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
}, tickRate);

server.listen(port, "0.0.0.0", () => {
  console.log(`Advent server listening on http://0.0.0.0:${port}`);
  console.log(`WebSocket endpoint ws://127.0.0.1:${port}`);
});

function sanitizeName(value: string | null) {
  if (!value) {
    return "";
  }
  return value.replace(/[^a-zA-Z0-9 -]/g, "").trim().slice(0, 18);
}
