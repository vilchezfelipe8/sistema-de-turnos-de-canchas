import pino from 'pino';

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type LogContext = {
  requestId?: string;
  clubId?: number;
  userId?: number;
  path?: string;
  method?: string;
  [key: string]: unknown;
};

let requestContext: LogContext = {};

export const setLogContext = (ctx: LogContext) => {
  requestContext = { ...requestContext, ...ctx };
};

export const clearLogContext = () => {
  requestContext = {};
};

export const getRequestLogger = (ctx?: LogContext) => {
  const merged = { ...requestContext, ...ctx };
  const child = Object.keys(merged).length > 0
    ? baseLogger.child(merged)
    : baseLogger;
  return child;
};

const logger = {
  info: (msgOrObj: string | object, msg?: string) => {
    const child = getRequestLogger();
    if (typeof msgOrObj === 'object') {
      child.info(msgOrObj, msg ?? '');
    } else {
      child.info(msgOrObj);
    }
  },
  warn: (msgOrObj: string | object, msg?: string) => {
    const child = getRequestLogger();
    if (typeof msgOrObj === 'object') {
      child.warn(msgOrObj, msg ?? '');
    } else {
      child.warn(msgOrObj);
    }
  },
  error: (msgOrObj: string | object, msg?: string) => {
    const child = getRequestLogger();
    if (typeof msgOrObj === 'object') {
      child.error(msgOrObj, msg ?? '');
    } else {
      child.error(msgOrObj);
    }
  },
  child: (bindings: LogContext) => getRequestLogger(bindings),
};

export { logger, baseLogger };
