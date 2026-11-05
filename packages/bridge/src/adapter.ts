import { DesktopIpc } from "./desktop-ipc.js";
import {
  applyPatches,
  projectThread,
  type RemoteThread,
} from "../../protocol/src/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";


import { hostTool } from "./host-tools.js";
import { readArtifact } from "./artifacts.js";
import { ensureThreadOwner } from "./load-thread.js";
export class DesktopAdapter extends EventEmitter {
  ipc = new DesktopIpc();
  states = new Map<string, { revision: number; state: any }>();
  owners = new Map<string, string>();
  private subscriptions = new Map<string, Promise<RemoteThread>>();
  private updates = new Map<string, ReturnType<typeof setTimeout>>();
  async connect() {
    this.ipc.on("message", (m) => {
      if (
        m.method !== "thread-stream-state-changed" ||
        m.params?.hostId !== "local"
      )
        return;
      const { conversationId, change } = m.params;
      const previous = this.states.get(conversationId);
      if (change.type === "snapshot") {
        this.states.set(conversationId, {
          revision: change.revision,
          state: change.conversationState,
        });
      } else if (change.type === "patches") {
        if (!previous || previous.revision !== change.baseRevision) {
          this.refresh(conversationId);
          return;
        }
        try {
          this.states.set(conversationId, {
            revision: change.revision,
            state: applyPatches(previous.state, change.patches),
          });
        } catch {
          this.refresh(conversationId);
          return;
        }
      }
      const urgent = change.type === 'snapshot' || change.patches?.some((p: any) =>
        p.path?.includes('requests') || (p.path?.at(-1) === 'status' && ['completed','interrupted','failed'].includes(p.value)));
      const flush = () => {
        const timer = this.updates.get(conversationId); if (timer) clearTimeout(timer);
        this.updates.delete(conversationId);
        const entry = this.states.get(conversationId);
        if (entry) this.emit('thread', projectThread(entry.state, entry.revision));
      };
      if (urgent) flush();
      else if (!this.updates.has(conversationId)) this.updates.set(conversationId, setTimeout(flush, 150));
    });
    this.ipc.on("disconnected", () => {
      this.states.clear();
      for (const timer of this.updates.values()) clearTimeout(timer); this.updates.clear();
      this.owners.clear();
      this.emit("offline");
    });
    await this.ipc.connect();
  }
  async catalog() {
    const { stdout } = await promisify(execFile)(
      "python",
      [
        fileURLToPath(new URL("./catalog.py", import.meta.url)),
        process.env.CODEX_HOME ?? "E:/Codex/home",
      ],
      { encoding: "utf8" }
    );
    return JSON.parse(stdout);
  }
  refresh(id: string) {
    this.ipc.broadcast(
      "thread-stream-following-changed",
      { hostId: "local", conversationId: id, following: true },
      1
    );
  }
  subscribe(id: string): Promise<RemoteThread> {
    const pending = this.subscriptions.get(id);
    if (pending) return pending;
    const result = this.subscribeDesktop(id).finally(() => this.subscriptions.delete(id));
    this.subscriptions.set(id, result);
    return result;
  }
  private async subscribeDesktop(id: string): Promise<RemoteThread> {
    const owner = await ensureThreadOwner({
      discover: () => this.ipc.request("thread-owner-discovery", { hostId: "local", conversationId: id }, 1, undefined, 1500),
      open: async () => {
        // Uses the running desktop's own navigation/loading path, never another process or fork.
        const result = await hostTool("navigate_to_codex_page", { threadId: id },
          process.env.CODEX_THREAD_ID ?? (await this.catalog())[0]?.id, 8000);
        if (result.navigated !== true) throw Error("DESKTOP_THREAD_LOAD_UNAVAILABLE");
      },
    });
    this.owners.set(id, owner.handledByClientId);
    const snapshot = new Promise<RemoteThread>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("thread", listener);
        reject(Error("SNAPSHOT_TIMEOUT"));
      }, 10000);
      const listener = (thread: RemoteThread) => {
        if (thread.id === id) {
          clearTimeout(timer);
          this.off("thread", listener);
          resolve(thread);
        }
      };
      this.on("thread", listener);
    });
    this.refresh(id);
    return snapshot;
  }
  async invoke(method: string, p: any) {
    if (method === "thread/list") return this.catalog();
    if (method === "thread/read") return this.subscribe(p.threadId);
    if (method === "project/list")
      return hostTool(
        "list_projects",
        {},
        p.contextThreadId ??
          process.env.CODEX_THREAD_ID ??
          (await this.catalog())[0]?.id
      );
    if (method === "thread/start") {
      if (typeof p.text !== "string" || !p.text.trim())
        throw Error("MESSAGE_REQUIRED");
      const projects = await hostTool(
        "list_projects",
        {},
        p.contextThreadId ?? process.env.CODEX_THREAD_ID
      );
      const list = Array.isArray(projects) ? projects : projects.projects ?? [];
      if (!list.some((project: any) => project.projectId === p.projectId))
        throw Error("PROJECT_NOT_FOUND");
      return hostTool(
        "create_thread",
        {
          title: p.title ?? "手机新建聊天",
          prompt: p.text,
          target: {
            type: "project",
            projectId: p.projectId,
            environment: { type: "local" },
          },
        },
        p.contextThreadId ?? process.env.CODEX_THREAD_ID
      );
    }
    const id = p.threadId,
      entry = this.states.get(id);
    if (!entry) throw Error("OPEN_THREAD_FIRST");
    if (method.startsWith("artifact/")) {
      return readArtifact(method, p, projectThread(entry.state, entry.revision).items);
    }
    const owner = await this.ipc.request(
      "thread-owner-discovery",
      { hostId: "local", conversationId: id },
      1
    );
    let name: string,
      version = 1,
      params: any = { conversationId: id };
    if (method === "turn/start") {
      name = "thread-follower-start-turn";
      version = 2;
      params.turnStart = {
        request: {
          threadId: id,
          input: [{ type: "text", text: p.text, text_elements: [] }],
          attachments: [],
          clientUserMessageId: p.messageId,
        },
        context: {},
      };
    } else if (method === "turn/steer") {
      name = "thread-follower-steer-turn";
      params = {
        ...params,
        input: [{ type: "text", text: p.text, text_elements: [] }],
        clientUserMessageId: p.messageId,
        attachments: [],
        restoreMessage: {
          id: p.messageId,
          text: p.text,
          cwd: entry.state.cwd,
          createdAt: Date.now(),
          context: {
            prompt: p.text,
            addedFiles: [],
            fileAttachments: [],
            imageAttachments: [],
            ideContext: null,
          },
        },
      };
    } else if (method === "turn/interrupt") {
      name = "thread-follower-interrupt-turn";
      version = 4;
      params = { ...params, mode: "user-stop", expectedTurnId: p.turnId };
    } else if (method === "approval/respond") {
      const request = entry.state.requests?.find(
        (r: any) => String(r.id ?? r.requestId) === String(p.requestId)
      );
      if (!request) throw Error("APPROVAL_EXPIRED");
      if (
        request.method !==
        (p.kind === "file"
          ? "item/fileChange/requestApproval"
          : "item/commandExecution/requestApproval")
      )
        throw Error("APPROVAL_KIND_MISMATCH");
      if (!["accept", "decline"].includes(p.decision))
        throw Error("INVALID_DECISION");
      name =
        p.kind === "file"
          ? "thread-follower-file-approval-decision"
          : "thread-follower-command-approval-decision";
      params = { ...params, requestId: p.requestId, decision: p.decision };
    } else if (method === "input/respond") {
      if (
        !entry.state.requests?.some(
          (r: any) =>
            r.id === p.requestId && r.method === "item/tool/requestUserInput"
        )
      )
        throw Error("INPUT_REQUEST_EXPIRED");
      name = "thread-follower-submit-user-input";
      params = { ...params, requestId: p.requestId, response: p.response };
    } else if (method === "model/read") {
      name = "thread-follower-read-model-settings";
    } else if (method === "thread/history") {
      name = "thread-follower-load-complete-history";
    } else throw Error("CAPABILITY_UNAVAILABLE");
    return (
      await this.ipc.request(
        name,
        params,
        version,
        owner.handledByClientId,
        30000
      )
    ).result;
  }
}
