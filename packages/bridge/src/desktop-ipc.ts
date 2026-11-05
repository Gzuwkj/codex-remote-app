import net from "node:net";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export type IpcMessage = {
  type: string;
  requestId?: string;
  method?: string;
  resultType?: string;
  result?: any;
  error?: string;
  params?: any;
  [key: string]: any;
};
export function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameReader {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): IpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: IpcMessage[] = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE();
      if (size > 32 * 1024 * 1024) throw Error("IPC_FRAME_TOO_LARGE");
      if (this.buffer.length < 4 + size) break;
      messages.push(
        JSON.parse(this.buffer.subarray(4, 4 + size).toString("utf8"))
      );
      this.buffer = this.buffer.subarray(4 + size);
    }
    return messages;
  }
}
/** Desktop's existing local router. Never starts a second app-server. */
export class DesktopIpc extends EventEmitter {
  clientId = "initializing-client";
  private socket?: net.Socket;
  private pending = new Map<
    string,
    {
      resolve: (value: IpcMessage) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  async connect(
    endpoint = process.env.CODEX_DESKTOP_PIPE ?? "\\\\.\\pipe\\codex-ipc"
  ) {
    const reader = new FrameReader();
    this.socket = net.createConnection(endpoint);
    this.socket.on("data", (chunk) => {
      try {
        for (const message of reader.push(chunk)) this.receive(message);
      } catch (error) {
        this.socket?.destroy(error as Error);
      }
    });
    this.socket.on("error", (error) => this.emit("transportError", error));
    this.socket.on("close", () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("DESKTOP_DISCONNECTED"));
      }
      this.pending.clear();
      this.emit("disconnected");
    });
    await new Promise<void>((resolve, reject) => {
      this.socket!.once("connect", resolve);
      this.socket!.once("error", reject);
    });
    const response = await this.request(
      "initialize",
      { clientType: "codex-remote-bridge" },
      0
    );
    this.clientId = response.result.clientId;
    return response;
  }
  private receive(message: IpcMessage) {
    if (message.type === "response" && message.requestId) {
      const p = this.pending.get(message.requestId);
      if (p) {
        this.pending.delete(message.requestId);
        clearTimeout(p.timer);
        message.resultType === "error"
          ? p.reject(Error(message.error ?? "DESKTOP_ERROR"))
          : p.resolve(message);
      }
    } else if (message.type === "client-discovery-request")
      this.send({
        type: "client-discovery-response",
        requestId: message.requestId,
        response: { canHandle: false },
      });
    else this.emit("message", message);
  }
  send(message: unknown) {
    if (!this.socket?.writable) throw Error("DESKTOP_DISCONNECTED");
    this.socket.write(frame(message));
  }
  request(
    method: string,
    params: unknown,
    version: number,
    targetClientId?: string,
    timeoutMs = 10000
  ) {
    const requestId = randomUUID();
    return new Promise<IpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error("DESKTOP_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.send({
          type: "request",
          requestId,
          sourceClientId: this.clientId,
          method,
          params,
          version,
          targetClientId,
          timeoutMs,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error as Error);
      }
    });
  }
  broadcast(
    method: string,
    params: unknown,
    version: number,
    targetClientIds?: string[]
  ) {
    this.send({
      type: "broadcast",
      method,
      params,
      version,
      sourceClientId: this.clientId,
      targetClientIds,
    });
  }
  close() {
    this.socket?.destroy();
  }
}
