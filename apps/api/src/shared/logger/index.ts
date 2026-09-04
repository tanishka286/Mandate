type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  request_id?: string;
  [key: string]: unknown;
}

const SECRET_KEY_PATTERN =
  /(secret|password|token|authorization|api[_-]?key|service[_-]?role|jwt|razorpay)/i;

function redact(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...((redact(fields) as LogFields) ?? {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
