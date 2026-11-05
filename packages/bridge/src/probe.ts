import { DesktopIpc } from "./desktop-ipc.js";
const ipc = new DesktopIpc();
try {
  const initialized = await ipc.connect();
  console.log(
    JSON.stringify({
      stage: "desktop-ipc",
      connected: true,
      clientId: initialized.result.clientId,
    })
  );
  const conversationId = process.argv[2];
  if (conversationId) {
    const owner = await ipc.request(
      "thread-owner-discovery",
      { hostId: "local", conversationId },
      1
    );
    console.log(JSON.stringify({ stage: "owner-discovery", ...owner }));
  }
} catch (error) {
  console.error(
    JSON.stringify({ connected: false, error: (error as Error).message })
  );
  process.exitCode = 1;
} finally {
  ipc.close();
}
