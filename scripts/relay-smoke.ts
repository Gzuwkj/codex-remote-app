import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";
const ws = new WebSocket("ws://127.0.0.1:8787");
let epoch = "";
const threadId = "01a1aae8-72db-7021-a2b0-d65d772364b4";
ws.on("open", () =>
  ws.send(
    JSON.stringify({
      type: "pair.request",
      code: process.argv[2],
      name: "Local protocol acceptance",
    })
  )
);
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "paired") {
    writeFileSync(".state/test-device.json", JSON.stringify(m), {
      mode: 0o600,
    });
    epoch = m.epoch;
    ws.send(
      JSON.stringify({
        type: "command",
        epoch,
        id: "smoke-list",
        method: "thread/list",
        params: {},
      })
    );
  } else if (m.type === "command.result" && m.id.endsWith(":smoke-list")) {
    console.log(
      JSON.stringify({
        stage: "catalog",
        count: m.result?.length,
        error: m.error,
      })
    );
    ws.send(
      JSON.stringify({
        type: "command",
        epoch,
        id: "smoke-read",
        method: "thread/read",
        params: { threadId },
      })
    );
  } else if (m.type === "command.result" && m.id.endsWith(":smoke-read")) {
    console.log(
      JSON.stringify({
        stage: "same-thread",
        id: m.result?.id,
        items: m.result?.items?.length,
        error: m.error,
      })
    );
    ws.close();
  } else if (m.type === "error") console.log(m);
});
setTimeout(() => {
  ws.close();
  process.exitCode = 1;
}, 60000).unref();
