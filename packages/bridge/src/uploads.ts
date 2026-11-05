import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  open,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
type Upload = {
  id: string;
  owner: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  complete?: boolean;
};
export class UploadStore {
  constructor(private root: string) {}
  private directory(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error("INVALID_UPLOAD_ID");
    return path.join(this.root, id);
  }
  async invoke(method: string, p: any, owner: string) {
    if (!owner) throw Error("UPLOAD_OWNER_REQUIRED");
    const dir = this.directory(p.id),
      metaFile = path.join(dir, "metadata.json");
    let meta: Upload | undefined;
    try {
      meta = JSON.parse(await readFile(metaFile, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (meta && meta.owner !== owner) throw Error("UPLOAD_OWNER_MISMATCH");
    if (method === "attachment/begin") {
      if (
        !Number.isSafeInteger(p.size) ||
        p.size < 1 ||
        p.size > 20 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(p.sha256)
      )
        throw Error("INVALID_UPLOAD_SIZE_OR_HASH");
      if (meta && (meta.sha256 !== p.sha256 || meta.size !== p.size))
        throw Error("UPLOAD_ID_CONFLICT");
      if (!meta) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let name =
          String(p.name ?? "attachment")
            .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
            .slice(0, 120)
            .replace(/[. ]+$/g, "") || "attachment";
        if (
          ["payload.part", "metadata.json"].includes(name.toLowerCase()) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
        )
          name = "attachment-" + name;
        meta = {
          id: p.id,
          owner,
          name,
          mime: String(p.mime ?? "application/octet-stream").slice(0, 100),
          size: p.size,
          sha256: p.sha256,
        };
        await writeFile(metaFile, JSON.stringify(meta), { mode: 0o600 });
        await writeFile(path.join(dir, "payload.part"), Buffer.alloc(0), {
          mode: 0o600,
        });
      }
      const file = path.join(dir, meta.complete ? meta.name : "payload.part");
      return {
        id: meta.id,
        next: (await stat(file)).size,
        complete: !!meta.complete,
      };
    }
    if (!meta) throw Error("UPLOAD_NOT_FOUND");
    const file = path.join(dir, meta.complete ? meta.name : "payload.part");
    if (method === "attachment/chunk") {
      if (
        typeof p.base64 !== "string" ||
        p.base64.length > 350000 ||
        p.base64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(p.base64)
      )
        throw Error("INVALID_UPLOAD_CHUNK");
      const bytes = Buffer.from(p.base64, "base64"),
        size = (await stat(file)).size;
      if (
        !Number.isSafeInteger(p.offset) ||
        p.offset < 0 ||
        p.offset > size ||
        p.offset + bytes.length > meta.size
      )
        throw Error("UPLOAD_OFFSET_GAP");
      const handle = await open(file, "r+");
      try {
        if (p.offset < size) {
          const prior = Buffer.alloc(bytes.length);
          const read = await handle.read(prior, 0, bytes.length, p.offset);
          if (read.bytesRead !== bytes.length || !prior.equals(bytes))
            throw Error("UPLOAD_CHUNK_CONFLICT");
          return { next: size };
        }
        if (meta.complete) throw Error("UPLOAD_ALREADY_COMPLETE");
        const written = await handle.write(bytes, 0, bytes.length, p.offset);
        if (written.bytesWritten !== bytes.length)
          throw Error("UPLOAD_WRITE_INCOMPLETE");
        return { next: p.offset + bytes.length };
      } finally {
        await handle.close();
      }
    }
    if (method === "attachment/finish") {
      const bytes = await readFile(file);
      if (
        bytes.length !== meta.size ||
        createHash("sha256").update(bytes).digest("hex") !== meta.sha256
      )
        throw Error("UPLOAD_HASH_MISMATCH");
      if (!meta.complete) {
        if (meta.name === "payload.part" || meta.name === "metadata.json")
          meta.name = "attachment-" + meta.name;
        await rename(file, path.join(dir, meta.name));
        meta.complete = true;
        await writeFile(metaFile, JSON.stringify(meta), { mode: 0o600 });
      }
      return { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime };
    }
    if (method === "attachment/read") {
      if (!meta.complete) throw Error("UPLOAD_NOT_READY");
      if (
        /^image\/(png|jpeg|webp)$/.test(meta.mime) &&
        meta.size <= 6 * 1024 * 1024
      )
        return {
          dataUri: `data:${meta.mime};base64,${(await readFile(file)).toString(
            "base64"
          )}`,
        };
      if (
        /^(text\/|application\/json)/.test(meta.mime) &&
        meta.size <= 1024 * 1024
      )
        return { text: await readFile(file, "utf8") };
      return { text: "此格式或大小暂不支持手机预览，可在电脑中查看。" };
    }
    throw Error("CAPABILITY_UNAVAILABLE");
  }
  async resolve(ids: string[], owner: string) {
    if (!Array.isArray(ids) || ids.length > 5)
      throw Error("TOO_MANY_ATTACHMENTS");
    return Promise.all(
      ids.map(async (id) => {
        const dir = this.directory(id),
          meta: Upload = JSON.parse(
            await readFile(path.join(dir, "metadata.json"), "utf8")
          );
        if (meta.owner !== owner || !meta.complete)
          throw Error("UPLOAD_NOT_READY");
        const file = path.resolve(dir, meta.name);
        if (path.dirname(file) !== path.resolve(dir))
          throw Error("INVALID_UPLOAD_PATH");
        return { ...meta, path: file };
      })
    );
  }
}
