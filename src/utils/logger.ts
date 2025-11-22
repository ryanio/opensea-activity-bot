import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { inspect } from "node:util";
import { shortTokenAddr } from "./utils";

type Level = "debug" | "info" | "warn" | "error";

const { LOG_LEVEL, DEBUG_LOG_FILE, DEBUG_LOG_MAX_BYTES } = process.env;

const levelOrder: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const selectedLevel: Level = ((): Level => {
  if (LOG_LEVEL === "debug") {
    return "debug";
  }
  if (LOG_LEVEL === "info") {
    return "info";
  }
  if (LOG_LEVEL === "warn") {
    return "warn";
  }
  if (LOG_LEVEL === "error") {
    return "error";
  }
  return "info";
})();

const shouldLog = (level: Level): boolean =>
  levelOrder[level] >= levelOrder[selectedLevel];

export const isDebugEnabled = (): boolean => selectedLevel === "debug";

const serialize = (arg: unknown): string => {
  if (typeof arg === "string") {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return inspect(arg, { depth: 3, breakLength: 120 });
  }
};

const write = (level: Level, parts: unknown[]) => {
  const ts = new Date().toISOString();
  const msg = parts.map(serialize).join(" ");
  const line = `${ts} [${level.toUpperCase()}] [Activity] [${shortTokenAddr}] ${msg}\n`;
  writeDebugFile(line);
  if (!shouldLog(level)) {
    return;
  }
  writeConsole(line, level);
};

const writeConsole = (line: string, level: Level): void => {
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
};

const DEFAULT_DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024;

let debugLogInitialized = false;
const debugLogFilePath: string | undefined = DEBUG_LOG_FILE;
let debugLogMaxBytes = DEFAULT_DEBUG_LOG_MAX_BYTES;
let debugLogSize = 0;

const initDebugLogConfig = (): void => {
  if (debugLogInitialized) {
    return;
  }
  debugLogInitialized = true;
  if (!debugLogFilePath) {
    return;
  }
  const parsedMax = Number(DEBUG_LOG_MAX_BYTES ?? DEFAULT_DEBUG_LOG_MAX_BYTES);
  debugLogMaxBytes =
    Number.isNaN(parsedMax) || parsedMax <= 0
      ? DEFAULT_DEBUG_LOG_MAX_BYTES
      : parsedMax;
  try {
    const stats = statSync(debugLogFilePath);
    debugLogSize = stats.size;
  } catch {
    debugLogSize = 0;
  }
};

const writeDebugFile = (line: string): void => {
  if (!debugLogFilePath) {
    return;
  }
  initDebugLogConfig();
  if (!debugLogFilePath) {
    return;
  }
  try {
    const dir = dirname(debugLogFilePath);
    mkdirSync(dir, { recursive: true });
    const bytes = Buffer.byteLength(line);
    if (debugLogSize + bytes > debugLogMaxBytes) {
      // Truncate the file when it grows beyond the limit to keep only recent logs
      writeFileSync(debugLogFilePath, "");
      debugLogSize = 0;
    }
    appendFileSync(debugLogFilePath, line);
    debugLogSize += bytes;
  } catch {
    // Swallow file logging errors – console logging is the primary channel
  }
};

export const logger = {
  debug: (...parts: unknown[]) => write("debug", parts),
  info: (...parts: unknown[]) => write("info", parts),
  warn: (...parts: unknown[]) => write("warn", parts),
  error: (...parts: unknown[]) => write("error", parts),
};

export const prefixedLogger = (prefix: string) => {
  const add = (parts: unknown[]) => [`[${prefix}]`, ...parts];
  return {
    debug: (...parts: unknown[]) => logger.debug(...add(parts)),
    info: (...parts: unknown[]) => logger.info(...add(parts)),
    warn: (...parts: unknown[]) => logger.warn(...add(parts)),
    error: (...parts: unknown[]) => logger.error(...add(parts)),
  } as const;
};
