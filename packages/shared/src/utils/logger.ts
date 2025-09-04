import pino from 'pino';

// Create base logger configuration
const createLogger = (serviceName: string, options: pino.LoggerOptions = {}) => {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: {
      service: serviceName,
      ...(options.base || {})
    },
    ...options
  });
};

// Default logger for shared utilities
export const logger = createLogger('bookmark-shared');

// Factory function for creating service-specific loggers
export const createServiceLogger = (serviceName: string, options?: pino.LoggerOptions) => {
  return createLogger(serviceName, options);
};

// Re-export pino types for convenience
export type { Logger } from 'pino';