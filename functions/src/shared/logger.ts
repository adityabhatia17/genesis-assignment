import * as fnLogger from 'firebase-functions/logger';

export type LogFields = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}): Logger {
  const emit = (level: Level) => (message: string, fields: LogFields = {}) => {
    fnLogger[level](message, { ...base, ...fields });
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/** Serializes an unknown error for server-side logs only. */
export function serializeError(err: unknown): LogFields {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { value: String(err) };
}
