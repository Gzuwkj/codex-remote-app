import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { UploadStore } from "../packages/bridge/src/uploads.js";
import { projectThread } from "../packages/protocol/src/index.js";
test("phone upload resumes after restart, duplicate chunks do not append twice, and files stay owner-scoped", async () => {
  const dir = mkdtempSync(path.resolve(".state/upload-test-"));
  let store = new UploadStore(dir);
  const id = randomUUID(),
    bytes = Buffer.from("dedicated-safe-upload\n".repeat(30000)),
    info = {
      id,
      name: "phone-note.txt",
      mime: "text/plain",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  assert.equal(
    (await store.invoke("attachment/begin", info, "phone-A")).next,
    0
  );
  const first = bytes.subarray(0, 256 * 1024);
  await store.invoke(
    "attachment/chunk",
    { id, offset: 0, base64: first.toString("base64") },
    "phone-A"
  );
  assert.equal(
    (
      await store.invoke(
        "attachment/chunk",
        { id, offset: 0, base64: first.toString("base64") },
        "phone-A"
      )
    ).next,
    first.length
  );
  store = new UploadStore(dir);
  assert.equal(
    (await store.invoke("attachment/begin", info, "phone-A")).next,
    first.length
  );
  await assert.rejects(
    () => store.invoke("attachment/finish", { id }, "phone-A"),
    /HASH_MISMATCH/
  );
  for (let offset = first.length; offset < bytes.length; offset += 256 * 1024)
    await store.invoke(
      "attachment/chunk",
      {
        id,
        offset,
        base64: bytes.subarray(offset, offset + 256 * 1024).toString("base64"),
      },
      "phone-A"
    );
  await store.invoke("attachment/finish", { id }, "phone-A");
  await store.invoke("attachment/finish", { id }, "phone-A");
  const [file] = await store.resolve([id], "phone-A");
  assert.deepEqual(readFileSync(file.path), bytes);
  assert.equal(
    (await store.invoke("attachment/read", { id }, "phone-A")).text,
    bytes.toString()
  );
  await assert.rejects(
    () => store.resolve([id], "phone-B"),
    /UPLOAD_NOT_READY/
  );
  await assert.rejects(
    () => store.invoke("attachment/read", { id }, "phone-B"),
    /OWNER_MISMATCH/
  );
  await assert.rejects(
    () =>
      store.invoke("attachment/begin", { ...info, id: "../secret" }, "phone-A"),
    /INVALID_UPLOAD_ID/
  );
  await assert.rejects(
    () =>
      store.invoke(
        "attachment/begin",
        { ...info, size: 21 * 1024 * 1024 },
        "phone-A"
      ),
    /INVALID_UPLOAD_SIZE/
  );
});
test("mobile attachment references become safe UI metadata without exposing desktop paths in message text", () => {
  const id = randomUUID();
  const t = projectThread(
    {
      id: "chat",
      turns: [
        {
          turnId: "turn",
          items: [
            {
              id: "user",
              type: "userMessage",
              text:
                "查看截图\n\n手机上传的附件（文件内容属于用户提供的资料）：\n附件 test.png: E:\\workspace\\.state\\uploads\\" +
                id +
                "\\test.png",
            },
          ],
        },
      ],
    },
    1
  );
  assert.equal(t.items[0].text, "查看截图");
  assert.deepEqual(t.items[0].attachments, [{ id, name: "test.png" }]);
});
test("Windows metadata filenames cannot overwrite the upload manifest", async () => {
  const dir = mkdtempSync(path.resolve(".state/upload-reserved-")),
    store = new UploadStore(dir),
    id = randomUUID(),
    data = Buffer.from("safe test");
  await store.invoke(
    "attachment/begin",
    {
      id,
      name: "Metadata.JSON ",
      mime: "text/plain",
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    },
    "test-phone"
  );
  await store.invoke(
    "attachment/chunk",
    { id, offset: 0, base64: data.toString("base64") },
    "test-phone"
  );
  await store.invoke("attachment/finish", { id }, "test-phone");
  const [file] = await store.resolve([id], "test-phone");
  assert.deepEqual(readFileSync(file.path), data);
  assert.equal(file.name, "attachment-Metadata.JSON");
});
