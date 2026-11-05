import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { localArtifactPath, referencedArtifacts, readArtifact } from "../packages/bridge/src/artifacts.js";

test("desktop Markdown image and file references accept drive links, encoded spaces and line suffixes", () => {
  assert.equal(localArtifactPath("/E:/demo/a%20b.png:12"), "E:\\demo\\a b.png");
  assert.equal(localArtifactPath("https://example.com/image.png"), undefined);
  const refs = referencedArtifacts([
    { type: "agentMessage", text: "![图](/E:/demo/a.png) [文档](</E:/demo/a b.md:12>) [下载](/E:/demo/app.apk)" },
    { type: "userMessage", text: "[隐私](/E:/private.txt)" },
    { type: "imageView", image: "E:/demo/tool.png" },
  ]);
  assert.equal(refs.length, 4);
  assert.ok(!refs.some(p => p.includes("private")));
});
test("artifacts enforce chat references and chunk version; downloaded bytes match original", async () => {
  const folder = path.resolve("artifacts/artifact-regression-" + Date.now());
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, "test file.apk"), textFile = path.join(folder, "test.md");
  const source = Buffer.alloc(600000, 42);
  const items = [{ type: "agentMessage", text: `[下载](<${file}>) [记录](<${textFile}>)` }];
  try {
    await writeFile(file, source); await writeFile(textFile, "# 手机预览");
    await assert.rejects(readArtifact("artifact/info", { path: file }, []), /ARTIFACT_NOT_IN_THREAD/);
    const info = await readArtifact("artifact/info", { path: file }, items) as any;
    assert.equal(info.mime, "application/vnd.android.package-archive");
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < info.size;) {
      const chunk = await readArtifact("artifact/chunk", { path: file, version: info.version, offset }, items) as any;
      assert.ok(chunk.next > offset); offset = chunk.next; chunks.push(Buffer.from(chunk.base64, "base64"));
    }
    assert.deepEqual(Buffer.concat(chunks), source);
    await assert.rejects(readArtifact("artifact/chunk", { path: file, offset: -1, version: info.version }, items), /INVALID_OFFSET/);
    await assert.rejects(readArtifact("artifact/chunk", { path: file, offset: 0, version: "old" }, items), /ARTIFACT_CHANGED/);
    assert.equal((await readArtifact("artifact/read", { path: textFile }, items) as any).text, "# 手机预览");
  } finally { await unlink(file); await unlink(textFile); await rmdir(folder); }
});
