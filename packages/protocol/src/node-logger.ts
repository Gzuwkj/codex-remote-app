import {
  appendFileSync,
  mkdirSync,
  statSync,
  renameSync,
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { diagnosticDetails } from "./diagnostics.js";
export function createLogger(
  dir: string,
  role: string,
  maxBytes = 1024 * 1024
) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, role + ".log");
  return {
    file,
    log(event: string, details: Record<string, unknown> = {}, level = "INFO") {
      const line =
        JSON.stringify({
          at: new Date().toISOString(),
          role,
          pid: process.pid,
          level,
          event,
          ...diagnosticDetails(details),
        }) + "\n";
      // Managed Windows watchers must not accumulate an unbounded ReadToEnd buffer.
      if(process.env.BRIDGE_MANAGED!=='1')process.stdout.write(line);
      try {
        if (
          existsSync(file) &&
          statSync(file).size + Buffer.byteLength(line) > maxBytes
        ) {
          if (existsSync(file + ".1")) renameSync(file + ".1", file + ".2");
          renameSync(file, file + ".1");
        }
        appendFileSync(file, line, { mode: 0o600 });
      } catch {
        /* Logging must not stop task execution when a filesystem is unavailable. */
      }
    },
    tail() {
      try {
        return readFileSync(file, "utf8").slice(-128 * 1024);
      } catch {
        return "";
      }
    },
  };
}
