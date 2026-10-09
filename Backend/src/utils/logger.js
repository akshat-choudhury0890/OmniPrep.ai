import pino from 'pino';

export function createLogger(config) {
  const pretty = config.NODE_ENV === 'development';
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-omniprep-session"]',
        'res.headers["set-cookie"]',
        'res.headers["x-omniprep-session"]',
        '*.apiKey',
        '*.password',
      ],
      censor: '[redacted]',
    },
    transport: pretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
  });
}
