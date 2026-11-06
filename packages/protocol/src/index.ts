import {asyncQuestions,questionReplyText} from './questions.js';
import type {RemoteThread, RemoteItem} from './types.js';
export type {RemoteThread, RemoteItem} from './types.js';
export const protocolVersion = 1;
export type CommandStage =
  | "relay.received"
  | "bridge.accepted"
  | "command.result"
  | "outcome.unknown";
export type Command = {
  type: "command";
  id: string;
  epoch: string;
  method: string;
  params: Record<string, unknown>;
};
export function applyPatches(state: any, patches: any[]): any {
  let result = structuredClone(state);
  for (const p of patches) {
    if (
      !Array.isArray(p.path) ||
      p.path.some((k: any) =>
        ["__proto__", "constructor", "prototype"].includes(String(k))
      )
    )
      throw Error("INVALID_PATCH");
    if (!p.path.length) {
      result = p.value;
      continue;
    }
    let parent = result;
    for (const k of p.path.slice(0, -1)) {
      if (parent == null) throw Error("PATCH_GAP");
      parent = parent[k];
    }
    const key = p.path.at(-1);
    if (p.op === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else if (p.op === "add" && Array.isArray(parent))
      parent.splice(Number(key), 0, p.value);
    else if (p.op === "add" || p.op === "replace") parent[key] = p.value;
    else throw Error("INVALID_PATCH");
  }
  return result;
}
export function projectThread(state: any, revision: number): RemoteThread {
  const canonical = state.turnHistory?.history?.entitiesByKey;
  const turns: any[] = canonical
    ? Object.values(canonical).filter(
        (x: any) => x?.turnId && Array.isArray(x.items)
      )
    : state.turns ?? [];
  turns.sort((a, b) => (a.turnStartedAtMs ?? 0) - (b.turnStartedAtMs ?? 0));
  const items: RemoteItem[] = turns
    .flatMap((t) => t.items ?? [])
    .filter((i: any) => i.type !== "reasoning" && i.type !== "steered")
    .map((i: any) => {
      const createdInput =
        i.type === "functionCallOutput" && i.name === "create_thread"
          ? i.output?.match(/<input>([\s\S]*?)<\/input>/)?.[1]
          : undefined;
      const diff = Array.isArray(i.changes)
        ? i.changes
            .map((c: any) => `${c.path ?? ""}\n${c.diff ?? c.patch ?? ""}`)
            .join("\n\n")
        : undefined;
      const sourceText=i.text??i.restoreMessage?.text??(i.content??i.input)?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n')??'';
      const mobileBlock=/\n\n手机上传的附件（文件内容属于用户提供的资料）：\n([\s\S]*)$/.exec(sourceText);
      const phoneAttachments=mobileBlock?[...mobileBlock[1].matchAll(/[\\/]uploads[\\/]([a-f0-9-]{36})[\\/]([^\\/\r\n]+)/gi)].map(m=>({id:m[1],name:m[2]})):[];
      return {
        id: i.id,
        type:
          createdInput !== undefined || i.type === "steeringUserMessage"
            ? "userMessage"
            : i.type,
        status: i.status,
        text:
          (['userMessage','steeringUserMessage'].includes(i.type)?questionReplyText(sourceText):undefined)??
          (i.type==='userMessage'&&phoneAttachments.length?sourceText.slice(0,mobileBlock!.index):undefined)??
          createdInput ??
          i.text ??
          i.restoreMessage?.text ??
          (i.content ?? i.input)
            ?.filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n") ??
          i.aggregatedOutput ??
          (typeof i.output === "string" ? i.output : undefined) ??
          i.command ??
          diff ??
          (i.result !== undefined ? JSON.stringify(i.result) : ""),
        image: i.type === "imageView" ? i.path : undefined,
        ...(phoneAttachments.length?{attachments:phoneAttachments}:{}),
      };
    });
  return {
    id: state.id,
    title: state.title ?? "未命名聊天",
    cwd: state.cwd ?? state.latestThreadSettings?.cwd ?? "",
    model: state.latestModel,
    revision,
    activeTurnId: turns.findLast(
      (t) => t.status === "inProgress" || t.status === "in_progress"
    )?.turnId,
    lastTurnStatus: turns.at(-1)?.status,
    lastTurnId: turns.at(-1)?.turnId,
    items,
    requests: [...(state.requests ?? []), ...asyncQuestions(turns.flatMap(t=>t.items??[]))],
  };
}
