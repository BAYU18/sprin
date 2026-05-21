import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';

let registery: any;

export async function setupMetrics(fastify: FastifyInstance) {
    const promClient = await import('prom-client');

    const collectDefaultMetrics = promClient.collectDefaultMetrics;
    collectDefaultMetrics({ registery });

    fastify.get('/metrics', async (request, reply) => {
        reply.header('Content-Type', promClient.contentType);
        return promClient.register.metrics();
    });

    const httpRequestDuration = new promClient.Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code'],
        buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
    });

    const printJobsTotal = new promClient.Counter({
        name: 'print_jobs_total',
        help: 'Total number of print jobs',
        labelNames: ['status', 'printer']
    });

    const printerStatus = new promClient.Gauge({
        name: 'printer_status',
        help: 'Printer status (1=online, 0=offline)',
        labelNames: ['printer', 'type']
    });

    const queueSize = new promClient.Gauge({
        name: 'print_queue_size',
        help: 'Current print queue size',
        labelNames: ['printer']
    });

    const activeClients = new promClient.Gauge({
        name: 'active_clients',
        help: 'Number of active clients'
    });

    fastify.decorate('metrics', {
        httpRequestDuration,
        printJobsTotal,
        printerStatus,
        queueSize,
        activeClients,
        registery
    });

    fastify.addHook('onResponse', async (request, reply) => {
        httpRequestDuration
            .labels(request.method, request.url, reply.statusCode.toString())
            .observe(reply.elapsedTime);
    });

    logger.info('[Metrics] Prometheus metrics enabled at /metrics');

    return { promClient, registery };
}