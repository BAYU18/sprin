import http from 'http';
import { parseipp, serializeipp, IppResponse, IppRequest, IppOperation, IppStatus } from 'ipp';
import { logger } from '../utils/logger.js';
import { addPrintJob } from '../queues/index.js';
import { v4 as uuidv4 } from 'uuid';

const IPP_PORT = parseInt(process.env.IPP_PORT || '631');
const IPP_HOST = process.env.IPP_HOST || '0.0.0.0';

interface IppPrinterAttrs {
    'printer-uri-supported': string[];
    'printer-name': string;
    'printer-state': 'idle' | 'printing' | 'stopped';
    'printer-state-reasons': string[];
    'media-default': string;
    'media-supported': string[];
    'pages-default': string;
    'pages-supported': string[];
    'copies-default': number;
    'copies-supported': { min: number; max: number };
    'sides-default': 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
    'sides-supported': string[];
    'document-format-default': string;
    'document-format-supported': string[];
    'color-supported': boolean;
    'printer-is-shared': boolean;
    'printer-more-info': string;
}

interface IppJobAttrs {
    'job-id': number;
    'job-uri': string;
    'job-name': string;
    'job-originating-user-name': string;
    'job-state': 'pending' | 'pending-held' | 'processing' | 'completed' | 'cancelled' | 'aborted';
    'job-state-reasons': string[];
    'job-created': Date;
    'documents': number;
}

interface ParsedIppJob {
    'job-name': string;
    'document-format': string;
    'copies': number;
    'sides': 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
    'username': string;
    'printerSlug': string;
    'fileData': Buffer;
    'fileName': string;
}

interface PrinterInfo {
    id: number;
    name: string;
    slug: string;
    is_shared: boolean;
    status: string;
    config: any;
}

export class IppServer {
    private server: http.Server | null = null;
    private fastify: any;
    private printerCache: Map<string, PrinterInfo> = new Map();
    private cacheTimer: NodeJS.Timeout | null = null;

    constructor(fastify: any) {
        this.fastify = fastify;
    }

    async start(): Promise<void> {
        this.server = http.createServer(this.handleIppRequest.bind(this));

        this.server.on('error', (err) => {
            logger.error('[IPP] Server error:', err);
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.listen(IPP_PORT, IPP_HOST, () => {
                logger.info(`[IPP] Server listening on ${IPP_HOST}:${IPP_PORT}`);
                resolve();
            });
            this.server!.on('error', reject);
        });

        this.startCacheRefresh();
    }

    async stop(): Promise<void> {
        if (this.cacheTimer) {
            clearInterval(this.cacheTimer);
            this.cacheTimer = null;
        }

        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server!.close(() => {
                    logger.info('[IPP] Server stopped');
                    resolve();
                });
            });
            this.server = null;
        }
    }

    private startCacheRefresh(): void {
        this.refreshPrinterCache();
        this.cacheTimer = setInterval(() => {
            this.refreshPrinterCache();
        }, 30000);
    }

    private async refreshPrinterCache(): Promise<void> {
        try {
            const printers = await this.fastify.knex('printers')
                .where({ is_shared: true, status: 'online' })
                .select('id', 'name', 'slug', 'is_shared', 'status', 'config');

            this.printerCache.clear();
            for (const printer of printers) {
                this.printerCache.set(printer.slug, printer);
            }

            logger.debug(`[IPP] Refreshed printer cache: ${printers.length} printers`);
        } catch (error) {
            logger.error('[IPP] Failed to refresh printer cache:', error);
        }
    }

    private async handleIppRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST' && req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'application/ipp' });
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathSegments = url.pathname.split('/').filter(Boolean);

        if (pathSegments[0] === 'ipp' && pathSegments[1] === 'print' && pathSegments[2]) {
            const printerSlug = pathSegments[2];
            const printer = this.printerCache.get(printerSlug);

            if (!printer) {
                const printerFromDb = await this.fastify.knex('printers')
                    .where({ slug: printerSlug, is_shared: true })
                    .first();

                if (!printerFromDb) {
                    logger.warn(`[IPP] Printer not found: ${printerSlug}`);
                    const notFoundResponse = this.createIppErrorResponse(0x0401, 'printer-not-found');
                    res.writeHead(200, { 'Content-Type': 'application/ipp' });
                    res.end(serializeipp(notFoundResponse));
                    return;
                }
            }

            try {
                await this.handleIppPrintRequest(req, res, printerSlug);
            } catch (error) {
                logger.error(`[IPP] Error handling print request:`, error);
                const errorResponse = this.createIppErrorResponse(0x0500, 'internal-error');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(errorResponse));
            }
        } else {
            res.writeHead(404, { 'Content-Type': 'application/ipp' });
            res.end();
        }
    }

    private async handleIppPrintRequest(req: http.IncomingMessage, res: http.ServerResponse, printerSlug: string): Promise<void> {
        const chunks: Buffer[] = [];

        for await (const chunk of req) {
            chunks.push(chunk);
        }

        const body = Buffer.concat(chunks);

        if (body.length === 0) {
            const errorResponse = this.createIppErrorResponse(0x0500, 'bad-request');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
            return;
        }

        let request: IppRequest;
        try {
            request = parseipp(body) as IppRequest;
        } catch (error) {
            logger.error('[IPP] Failed to parse IPP request:', error);
            const errorResponse = this.createIppErrorResponse(0x0500, 'bad-request');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
            return;
        }

        const operationId = request.operation;
        logger.info(`[IPP] Received ${this.getOperationName(operationId)} request`);

        switch (operationId) {
            case IppOperation.Print-Job:
                await this.handlePrintJob(req, res, printerSlug, request, body);
                break;
            case IppOperation.Get-Printer-Attributes:
                await this.handleGetPrinterAttributes(req, res, printerSlug, request);
                break;
            case IppOperation.Get-Jobs:
                await this.handleGetJobs(req, res, printerSlug, request);
                break;
            case IppOperation.Cancel-Job:
                await this.handleCancelJob(req, res, printerSlug, request);
                break;
            case IppOperation.Validate-Job:
                await this.handleValidateJob(req, res, printerSlug, request);
                break;
            default:
                const notSupportedResponse = this.createIppErrorResponse(0x0501, 'operation-not-supported');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(notSupportedResponse));
        }
    }

    private async handlePrintJob(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        printerSlug: string,
        request: IppRequest,
        body: Buffer
    ): Promise<void> {
        try {
            const printer = await this.getPrinter(printerSlug);
            if (!printer) {
                const notFoundResponse = this.createIppErrorResponse(0x0401, 'printer-not-found');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(notFoundResponse));
                return;
            }

            const parsedJob = this.parseJobAttributes(request);
            if (!parsedJob['document-format']) {
                parsedJob['document-format'] = 'application/octet-stream';
            }

            const printJobData = {
                userId: 0,
                clientId: 0,
                printerId: printer.id,
                filePath: `ipp://${printerSlug}/${uuidv4()}`,
                fileName: parsedJob['job-name'] || 'IPP_Job',
                fileType: parsedJob['document-format'],
                copies: parsedJob['copies'] || 1,
                options: {
                    sides: parsedJob['sides'],
                    sourceApp: 'IPP_Mobility_Print',
                    ippJobId: request['job-id']
                }
            };

            const queuedJob = await addPrintJob(printJobData);

            const response: IppResponse = {
                status: IppStatus.Successful_OK,
                'job-id': typeof queuedJob.id === 'number' ? queuedJob.id : parseInt(String(queuedJob.id)),
                'job-uri': `ipp://${IPP_HOST}:${IPP_PORT}/ipp/print/${printerSlug}/${queuedJob.id}`,
                'job-state': 'pending',
                'job-state-reasons': ['job-incoming']
            };

            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(response));

            logger.info(`[IPP] Print-Job queued: ${queuedJob.id} for printer ${printerSlug}`);

        } catch (error: any) {
            logger.error('[IPP] Print-Job error:', error);
            const errorResponse = this.createIppErrorResponse(0x0500, 'internal-error');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
        }
    }

    private async handleGetPrinterAttributes(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        printerSlug: string,
        request: IppRequest
    ): Promise<void> {
        try {
            const printer = await this.getPrinter(printerSlug);
            if (!printer) {
                const notFoundResponse = this.createIppErrorResponse(0x0401, 'printer-not-found');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(notFoundResponse));
                return;
            }

            const attrs: IppPrinterAttrs = {
                'printer-uri-supported': [`ipp://${IPP_HOST}:${IPP_PORT}/ipp/print/${printerSlug}`],
                'printer-name': printer.name,
                'printer-state': printer.status === 'online' ? 'idle' : 'stopped',
                'printer-state-reasons': [],
                'media-default': 'na_letter_8.5x11in',
                'media-supported': [
                    'na_letter_8.5x11in',
                    'naLegal_8.5x14in',
                    'iso_a4_210x297mm',
                    'iso_a5_148x210mm',
                    'om_roku_3.94x3.94in'
                ],
                'pages-default': '1',
                'pages-supported': ['1-9999'],
                'copies-default': 1,
                'copies-supported': { min: 1, max: 9999 },
                'sides-default': 'one-sided',
                'sides-supported': ['one-sided', 'two-sided-long-edge', 'two-sided-short-edge'],
                'document-format-default': 'application/octet-stream',
                'document-format-supported': [
                    'application/octet-stream',
                    'application/pdf',
                    'application/postscript',
                    'image/jpeg',
                    'image/png',
                    'text/plain'
                ],
                'color-supported': true,
                'printer-is-shared': printer.is_shared,
                'printer-more-info': `http://${IPP_HOST}:${IPP_PORT}/api/printers/${printer.id}`
            };

            const response: IppResponse = {
                status: IppStatus.Successful_OK,
                ...attrs
            };

            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(response));

            logger.info(`[IPP] Get-Printer-Attributes for ${printerSlug}`);

        } catch (error: any) {
            logger.error('[IPP] Get-Printer-Attributes error:', error);
            const errorResponse = this.createIppErrorResponse(0x0500, 'internal-error');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
        }
    }

    private async handleGetJobs(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        printerSlug: string,
        request: IppRequest
    ): Promise<void> {
        try {
            const printer = await this.getPrinter(printerSlug);
            if (!printer) {
                const notFoundResponse = this.createIppErrorResponse(0x0401, 'printer-not-found');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(notFoundResponse));
                return;
            }

            const jobs = await this.fastify.knex('print_jobs')
                .where({ printer_id: printer.id })
                .orderBy('created_at', 'desc')
                .limit(100);

            const jobAttrs: IppJobAttrs[] = jobs.map((job: any) => ({
                'job-id': job.id,
                'job-uri': `ipp://${IPP_HOST}:${IPP_PORT}/ipp/print/${printerSlug}/${job.id}`,
                'job-name': job.job_name || job.file_name,
                'job-originating-user-name': job.user_id || 'unknown',
                'job-state': this.mapJobStatus(job.status),
                'job-state-reasons': [],
                'job-created': job.created_at,
                'documents': 1
            }));

            const response: IppResponse = {
                status: IppStatus.Successful_OK,
                'jobs': jobAttrs
            };

            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(response));

            logger.info(`[IPP] Get-Jobs for ${printerSlug}: ${jobs.length} jobs`);

        } catch (error: any) {
            logger.error('[IPP] Get-Jobs error:', error);
            const errorResponse = this.createIppErrorResponse(0x0500, 'internal-error');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
        }
    }

    private async handleCancelJob(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        printerSlug: string,
        request: IppRequest
    ): Promise<void> {
        try {
            const printer = await this.getPrinter(printerSlug);
            if (!printer) {
                const notFoundResponse = this.createIppErrorResponse(0x0401, 'printer-not-found');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(notFoundResponse));
                return;
            }

            const jobId = request['job-id'];
            if (!jobId) {
                const badRequestResponse = this.createIppErrorResponse(0x0400, 'missing-attribute');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(badRequestResponse));
                return;
            }

            const printRouter = this.fastify.printRouter;
            if (printRouter) {
                const result = await printRouter.cancelJob(String(jobId));
                if (!result.success) {
                    const notFoundResponse = this.createIppErrorResponse(0x0402, 'job-not-found');
                    res.writeHead(200, { 'Content-Type': 'application/ipp' });
                    res.end(serializeipp(notFoundResponse));
                    return;
                }
            }

            const response: IppResponse = {
                status: IppStatus.Successful_OK,
                'job-id': jobId,
                'job-state': 'cancelled'
            };

            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(response));

            logger.info(`[IPP] Cancel-Job ${jobId} for ${printerSlug}`);

        } catch (error: any) {
            logger.error('[IPP] Cancel-Job error:', error);
            const errorResponse = this.createIppErrorResponse(0x0500, 'internal-error');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
        }
    }

    private async handleValidateJob(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        printerSlug: string,
        request: IppRequest
    ): Promise<void> {
        try {
            const printer = await this.getPrinter(printerSlug);
            if (!printer) {
                const notFoundResponse = this.createIppErrorResponse(0x0401, 'printer-not-found');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(notFoundResponse));
                return;
            }

            const parsedJob = this.parseJobAttributes(request);

            if (!parsedJob['document-format']) {
                const badRequestResponse = this.createIppErrorResponse(0x0400, 'missing-attribute');
                res.writeHead(200, { 'Content-Type': 'application/ipp' });
                res.end(serializeipp(badRequestResponse));
                return;
            }

            const response: IppResponse = {
                status: IppStatus.Successful_OK,
                'job-validated': true
            };

            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(response));

            logger.info(`[IPP] Validate-Job for ${printerSlug}`);

        } catch (error: any) {
            logger.error('[IPP] Validate-Job error:', error);
            const errorResponse = this.createIppErrorResponse(0x0500, 'internal-error');
            res.writeHead(200, { 'Content-Type': 'application/ipp' });
            res.end(serializeipp(errorResponse));
        }
    }

    private parseJobAttributes(request: IppRequest): ParsedIppJob {
        const attrs = request.attributes || {};

        return {
            'job-name': attrs['job-name'] || attrs['job-name'] || 'IPP_Job',
            'document-format': attrs['document-format'] || 'application/octet-stream',
            'copies': typeof attrs['copies'] === 'number' ? attrs['copies'] : 1,
            'sides': this.parseSides(attrs['sides']),
            'username': attrs['requesting-user-name'] || attrs['job-originating-user-name'] || 'anonymous',
            'printerSlug': '',
            'fileData': Buffer.alloc(0),
            'fileName': (attrs['job-name'] as string) || 'IPP_Job'
        };
    }

    private parseSides(sides?: string | { type: string; value: string }): 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge' {
        if (!sides) {
            return 'one-sided';
        }

        const sidesStr = typeof sides === 'string' ? sides : (sides as any).value || 'one-sided';

        switch (sidesStr) {
            case 'two-sided-long-edge':
                return 'two-sided-long-edge';
            case 'two-sided-short-edge':
                return 'two-sided-short-edge';
            default:
                return 'one-sided';
        }
    }

    private createIppErrorResponse(statusCode: number, message: string): IppResponse {
        return {
            status: statusCode,
            'status-message': message
        } as IppResponse;
    }

    private async getPrinter(slug: string): Promise<PrinterInfo | null> {
        if (this.printerCache.has(slug)) {
            return this.printerCache.get(slug)!;
        }

        const printer = await this.fastify.knex('printers')
            .where({ slug, is_shared: true })
            .first();

        if (printer) {
            this.printerCache.set(slug, printer);
        }

        return printer || null;
    }

    private mapJobStatus(status: string): IppJobAttrs['job-state'] {
        switch (status) {
            case 'queued':
            case 'waiting':
                return 'pending';
            case 'processing':
                return 'processing';
            case 'completed':
                return 'completed';
            case 'cancelled':
                return 'cancelled';
            case 'failed':
                return 'aborted';
            default:
                return 'pending';
        }
    }

    private getOperationName(operationId: number): string {
        const operations: Record<number, string> = {
            0x0002: 'Print-Job',
            0x0004: 'Validate-Job',
            0x0005: 'Cancel-Job',
            0x0007: 'Get-Printer-Attributes',
            0x0009: 'Get-Jobs',
            0x000A: 'Pause-Printer',
            0x000B: 'Resume-Printer',
            0x000C: 'Purge-Jobs'
        };
        return operations[operationId] || `Unknown (0x${operationId.toString(16)})`;
    }
}

export default IppServer;