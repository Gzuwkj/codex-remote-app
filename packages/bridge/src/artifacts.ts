import path from "node:path";
import { open, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

export function localArtifactPath(value: string): string | undefined {
  let v: string;
  try { v = decodeURIComponent(value.trim().replace(/^<|>$/g, "")); } catch { return; }
  v = v.replace(/^\/(?=[a-z]:[\\/])/i, "").replace(/:\d+(?::\d+)?$/, "");
  if (!/^[a-z]:[\\/]/i.test(v)) return;
  return path.win32.normalize(v);
}
export function referencedArtifacts(items: { type: string; text?: string; image?: string }[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.image) result.push(item.image);
    if (item.type !== "agentMessage") continue;
    for (const match of (item.text ?? "").matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+)(?:\s+"[^"]*")?)\s*\)/g)) {
      const file = localArtifactPath(match[1] ?? match[2]);
      if (file) result.push(file);
    }
  }
  return result;
}
const mimeTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".apk": "application/vnd.android.package-archive", ".pdf": "application/pdf",
  ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json",
};
export async function readArtifact(method: string, params: any, items: any[]) {
  const file = localArtifactPath(params.path);
  if (!file || !referencedArtifacts(items).some(p => localArtifactPath(p)?.toLowerCase() === file.toLowerCase()))
    throw Error("ARTIFACT_NOT_IN_THREAD");
  const info = await stat(file);
  if (!info.isFile() || info.size > 128 * 1024 * 1024) throw Error("ARTIFACT_TOO_LARGE");
  const mime = mimeTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const version = createHash("sha256").update(`${info.size}:${info.mtimeMs}:${info.ino}`).digest("hex");
  if (method === "artifact/info") return { name: path.basename(file), size: info.size, mime, version };
  if (method === "artifact/chunk") {
    const offset = params.offset;
    if (params.version !== version) throw Error("ARTIFACT_CHANGED");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > info.size) throw Error("INVALID_OFFSET");
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(Math.min(256 * 1024, info.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      return { base64: buffer.subarray(0, bytesRead).toString("base64"), next: offset + bytesRead };
    } finally { await handle.close(); }
  }
  if (method !== "artifact/read") throw Error("CAPABILITY_UNAVAILABLE");
  if (/^image\//.test(mime) && info.size <= 6 * 1024 * 1024)
    return { dataUri: `data:${mime};base64,${(await readFile(file)).toString("base64")}` };
  if (["text/markdown", "text/plain", "application/json"].includes(mime) && info.size <= 1024 * 1024)
    return { text: await readFile(file, "utf8"), mime };
  throw Error("ARTIFACT_PREVIEW_UNSUPPORTED");
}
