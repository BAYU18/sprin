import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';
const prettyPrint = process.env.LOG_PRETTY === 'true';

export const logger = pino({
    level: logLevel,
    transport: prettyPrint ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined,
    base: {
        pid: process.pid
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => {
            return { level: label.toUpperCase() };
        }
    }
});

export default logger;