import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  diagnosticDetails,
  diagnosticError,
} from "../packages/protocol/src/diagnostics.js";
import { createLogger } from "../packages/protocol/src/node-logger.js";
test("diagnostics retain correlation metadata while dropping credentials and message contents", () => {
  const safe = diagnosticDetails({
    commandId: "dedicated-command",
    method: "turn/start",
    token: "TEST-SECRET",
    password: "TEST-PASSWORD",
    pairCode: "123456",
    params: { text: "PRIVATE CHAT" },
    text: "PRIVATE CHAT",
    result: "PRIVATE RESULT",
    url: "wss://user:secret@relay.test/ws?token=SECRET#SECRET",
  });
  const encoded = JSON.stringify(safe);
  for (const forbidden of [
    "TEST-SECRET",
    "TEST-PASSWORD",
    "123456",
    "PRIVATE CHAT",
    "PRIVATE RESULT",
    "user:secret",
    "?token=",
    "#SECRET",
  ])
    assert.equal(encoded.includes(forbidden), false);
  assert.equal(safe.commandId, "dedicated-command");
  assert.equal(diagnosticError(Error("DESKTOP_TIMEOUT")), "DESKTOP_TIMEOUT");
  assert.equal(diagnosticError(Error("secret private contents")), "Error");
});
test("rotating logs bound disk use and preserve readable recent records", () => {
  const dir = mkdtempSync(path.resolve(".state/diagnostics-test-")),
    logger = createLogger(dir, "test", 400);
  for (let i = 0; i < 15; i++)
    logger.log("test.record", {
      commandId: "dedicated-" + i,
      stage: "received",
      token: "PRIVATE-TOKEN",
    });
  const files = readdirSync(dir);
  assert.ok(files.length <= 3);
  assert.ok(logger.tail().includes("dedicated-14"));
  for (const f of files) {
    assert.ok(statSync(path.join(dir, f)).size < 800);
    assert.equal(
      readFileSync(path.join(dir, f), "utf8").includes("PRIVATE-TOKEN"),
      false
    );
  }
});
