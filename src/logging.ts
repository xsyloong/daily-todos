import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

let globalLoggingInstalled = false;

function normalizeLogValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? ` ${value.stack}` : ""}`;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function writeAppLog(level: string, message: string) {
  void invoke("write_app_log", { level, message }).catch(() => {
    // Logging must never break the UI.
  });
}

export function installGlobalErrorLogging(source: string) {
  if (globalLoggingInstalled) {
    return;
  }
  globalLoggingInstalled = true;

  const label = getCurrentWindow().label;
  writeAppLog("INFO", `${source} loaded label=${label}`);

  window.addEventListener("error", (event) => {
    writeAppLog(
      "ERROR",
      `${source} window error label=${label} message=${event.message} source=${event.filename}:${event.lineno}:${event.colno} error=${normalizeLogValue(
        event.error
      )}`
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    writeAppLog(
      "ERROR",
      `${source} unhandled rejection label=${label} reason=${normalizeLogValue(
        event.reason
      )}`
    );
  });
}
