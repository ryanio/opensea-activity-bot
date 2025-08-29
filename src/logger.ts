import { inspect } from 'node:util';

type Level = 'debug' | 'info' | 'warn' | 'error';

const { DEBUG, LOG_LEVEL } = process.env;

const levelOrder: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const selectedLevel: Level = ((): Level => {
  if (LOG_LEVEL === 'debug' || DEBUG === 'true') {
    return 'debug';
  }
  if (LOG_LEVEL === 'info') {
    return 'info';
  }
  if (LOG_LEVEL === 'warn') {
    return 'warn';
  }
  if (LOG_LEVEL === 'error') {
    return 'error';
  }
  return 'info';
})();

const shouldLog = (level: Level): boolean => {
  return levelOrder[level] >= levelOrder[selectedLevel];
};

const serialize = (arg: unknown): string => {
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return inspect(arg, { depth: 3, breakLength: 120 });
  }
};

const write = (level: Level, parts: unknown[]) => {
  if (!shouldLog(level)) {
    return;
  }
  const ts = new Date().toISOString();
  const msg = parts.map(serialize).join(' ');
  const line = `${ts} [${level.toUpperCase()}] ${msg}\n`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
};

export const logger = {
  debug: (...parts: unknown[]) => write('debug', parts),
  info: (...parts: unknown[]) => write('info', parts),
  warn: (...parts: unknown[]) => write('warn', parts),
  error: (...parts: unknown[]) => write('error', parts),
};
