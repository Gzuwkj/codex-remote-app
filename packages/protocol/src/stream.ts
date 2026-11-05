import type { RemoteThread } from "./types.js";
export type ThreadUpdate = {
  threadId: string;
  baseRevision: number;
  revision: number;
  meta: Omit<RemoteThread, "id" | "revision" | "items">;
  upserts: RemoteThread["items"];
  order?: string[];
};
export function threadUpdate(
  previous: RemoteThread,
  next: RemoteThread
): ThreadUpdate | undefined {
  if (previous.id !== next.id || next.revision <= previous.revision) return;
  const old = new Map(previous.items.map((i) => [i.id, i]));
  const upserts = next.items.filter((i) => {
    const p = old.get(i.id);
    return (
      !p ||
      p.type !== i.type ||
      p.text !== i.text ||
      p.status !== i.status ||
      p.image !== i.image || JSON.stringify(p.attachments??[])!==JSON.stringify(i.attachments??[])
    );
  });
  const orderChanged =
    previous.items.length !== next.items.length ||
    next.items.some((item, index) => item.id !== previous.items[index]?.id);
  const { id, revision, items, ...meta } = next;
  return {
    threadId: id,
    baseRevision: previous.revision,
    revision,
    meta,
    upserts,
    ...(orderChanged ? { order: items.map((i) => i.id) } : {}),
  };
}
export function applyThreadUpdate(
  previous: RemoteThread,
  update: ThreadUpdate
): RemoteThread {
  if (
    previous.id !== update.threadId ||
    previous.revision !== update.baseRevision ||
    update.revision <= update.baseRevision
  )
    throw Error("STREAM_REVISION_GAP");
  const changed = new Map(update.upserts.map((i) => [i.id, i]));
  const existing = new Map(previous.items.map((i) => [i.id, i]));
  const items = update.order
    ? update.order.map((id) => {
        const item = changed.get(id) ?? existing.get(id);
        if (!item) throw Error("STREAM_ITEM_GAP");
        return item;
      })
    : previous.items.map((i) => changed.get(i.id) ?? i);
  // Metadata is a complete replacement. Missing optional fields clear a completed turn.
  return { id: previous.id, ...update.meta, revision: update.revision, items };
}
