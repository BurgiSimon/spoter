import pino from "pino";

const globalForLogger = globalThis as unknown as { spoterLogger?: pino.Logger };

export const logger: pino.Logger =
  globalForLogger.spoterLogger ??
  pino({
    level: process.env.LOG_LEVEL ?? "info",
    // ESM hoists imports, so the worker is detected from its entry file rather than an env default.
    base: {
      service:
        process.env.SPOTER_SERVICE ??
        (/worker(\.mjs|[\\/]index\.ts)$/.test(process.argv[1] ?? "") ? "worker" : "web"),
    },
    redact: {
      paths: [
        "*.access_token",
        "*.refresh_token",
        "*.password",
        "*.token",
        "headers.authorization",
      ],
      censor: "[redacted]",
    },
  });

if (process.env.NODE_ENV !== "production") globalForLogger.spoterLogger = logger;
