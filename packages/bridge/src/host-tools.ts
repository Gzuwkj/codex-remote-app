import net from "node:net";
import { randomUUID } from "node:crypto";
import { frame, FrameReader } from "./desktop-ipc.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
/** Optional desktop-owned app-tools channel, supplied by the desktop executor. */
export async function hostTool(
  name: "list_projects" | "create_thread" | "navigate_to_codex_page",
  args: unknown,
  contextThreadId: string,
  timeoutMs = 30000
) {
  let endpoint = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  if (!endpoint) {
    const { stdout } = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object {$_ -match 'codex-app-tools-[a-f0-9-]+$'} | ConvertTo-Json -Compress",
      ],
      { timeout: 5000, windowsHide: true }
    );
    const paths = JSON.parse(stdout || "[]");
    const candidates = Array.isArray(paths) ? paths : [paths];
    if (candidates.length !== 1) throw Error("DESKTOP_APP_TOOLS_UNAVAILABLE");
    endpoint = candidates[0];
  }
  if (!endpoint) throw Error("DESKTOP_APP_TOOLS_UNAVAILABLE");
  const socket = net.createConnection(endpoint),
    reader = new FrameReader();
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const response = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Error("DESKTOP_TOOL_TIMEOUT"));
        socket.destroy();
      }, timeoutMs);
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("data", (chunk) => {
        try {
          for (const m of reader.push(chunk))
            if (m.id === 1) {
              clearTimeout(timer);
              m.error
                ? reject(Error((m.error as any).message))
                : resolve(m.result);
            }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      socket.write(
        frame({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            namespace: "codex_app",
            tool: name,
            arguments: args,
            callerSource: "codex",
            hostId: "local",
            threadId: contextThreadId,
            turnId: "remoteapp-" + randomUUID(),
            callId: "remoteapp-" + randomUUID(),
          },
        })
      );
    });
    if (!response.success)
      throw Error(
        response.contentItems?.find((x: any) => x.type === "inputText")?.text ??
          "DESKTOP_TOOL_FAILED"
      );
    const text = response.contentItems?.find(
      (x: any) => x.type === "inputText"
    )?.text;
    if (!text) throw Error("DESKTOP_TOOL_INVALID_RESULT");
    return JSON.parse(text);
  } finally {
    socket.destroy();
  }
}
