/**
 * IPP (Internet Printing Protocol) Server
 *
 * Implements a minimal IPP server that:
 *   1. Advertises printers from the `printers` table (those with a `client_id` = bound to a node agent)
 *   2. Accepts Print-Job requests from clients (e.g. Windows "Add Printer" via IPP)
 *   3. Forwards the print data to the appropriate client-agent which executes it on the
 *      physical printer via PowerShell `Out-Printer`
 *
 * Listens on a dedicated TCP port (default 631) — separate from the Fastify HTTP server
 * because IPP is a binary protocol spoken over HTTP/1.1 with a specific content-type.
 *
 * Reference: RFC 8010 (IPP/1.1), RFC 8011 (operation/attribute model)
 */

import * as net from 'net';
import * as http from 'http';
import { logger } from '../utils/logger.js';
import { ipp } from '../ipp-import.js';

const IPP_PORT = parseInt(process.env.IPP_PORT || '631');
const IPP_HOST = process.env.IPP_HOST || '0.0.0.0';

// IPP operation IDs (from RFC 8011)
const OP = {
    PRINT_JOB: 0x0002,
    PRINT_URI: 0x0003,
    VALIDATE_JOB: 0x0004,
    CREATE_JOB: 0x0005,
    SEND_DOCUMENT: 0x0006,
    CANCEL_JOB: 0x0008,
    GET_JOB_ATTRIBUTES: 0x0009,
    GET_JOBS: 0x000A,
    GET_PRINTER_ATTRIBUTES: 0x000B,
    GET_PRINTERS: 0x000C,
    CUPS_GET_DEFAULT: 0x4001,
    CUPS_GET_PRINTERS: 0x4002
};

// IPP status codes
const STATUS = {
    OK: 'successful-ok',
    OK_IGNORED: 'successful-ok-ignored-or-substituted-attributes',
    REDIRECT: 'redirection-other-site',
    CLIENT_ERROR: 'client-error',
    CLIENT_ERROR_BAD_REQUEST: 'client-error-bad-request',
    CLIENT_ERROR_NOT_FOUND: 'client-error-not-found',
    CLIENT_ERROR_URI: 'client-error-uri-scheme-not-supported',
    SERVER_ERROR: 'server-error',
    SERVER_ERROR_INTERNAL: 'server-error-internal-error'
};

// IPP tags
const TAG = {
    OPERATION: 0x01,
    JOB: 0x02,
    PRINTER: 0x04,
    UNSUPPORTED: 0x05,
    DELIMITER: 0x04
};

// Attribute syntaxes
const SYNTAX = {
    INTEGER: 0x21,
    BOOLEAN: 0x22,
    ENUM: 0x23,
    OCTET_STRING: 0x41,
    URI: 0x45,
    KEYWORD: 0x47,
    NAME_WITHOUT_LANG: 0x4A,
    TEXT_WITHOUT_LANG: 0x4B,
    NUMERIC: 0x4C,
    RANGE: 0x33
};

interface PrinterRecord {
    id: number;
    name: string;
    slug: string;
    driver: string;
    client_id: number | null;
    client_ip: string;
    status: string;
}

export class IPPServer {
    private server: net.Server | null = null;
    private getKnex: () => any;
    private getIO: () => any;
    private jobWaiters: Map<string, (result: any) => void> = new Map();

    constructor(opts: { getKnex: () => any; getIO: () => any }) {
        this.getKnex = opts.getKnex;
        this.getIO = opts.getIO;
    }

    start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = net.createServer((socket) => this.handleConnection(socket));
            this.server.listen(IPP_PORT, IPP_HOST, () => {
                logger.info(`[IPP] Server listening on ${IPP_HOST}:${IPP_PORT}`);
                logger.info(`[IPP] Users can add printers with URL: ipp://<server-ip>:${IPP_PORT}/printers/<slug>`);
                resolve();
            });
        });
    }

    handleAgentResult(data: { jobId: number | string; success: boolean; method?: string; error?: string }) {
        const waiter = this.jobWaiters.get(String(data.jobId));
        if (waiter) {
            waiter(data);
            this.jobWaiters.delete(String(data.jobId));
        } else {
            logger.warn(`[IPP] No waiter for job ${data.jobId}`);
        }
    }

    private async forwardToAgent(clientId: number, payload: any): Promise<any> {
        const io = this.getIO();
        if (!io) throw new Error('Socket.IO not available');

        // Wait for agent to send back result
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.jobWaiters.delete(String(payload.jobId));
                reject(new Error('Print job timed out after 30s'));
            }, 30000);

            this.jobWaiters.set(String(payload.jobId), (result) => {
                clearTimeout(timeout);
                resolve(result);
            });

            // Push job to the agent's room
            io.to(`client:${clientId}`).emit('print:execute', payload);
            logger.info(`[IPP] Job ${payload.jobId} dispatched to client:${clientId} room`);
        });
    }

    // ── Connection handler ──────────────────────────────────────────────────

    private handleConnection(socket: net.Socket) {
        let buffer = Buffer.alloc(0);
        const peer = `${socket.remoteAddress}:${socket.remotePort}`;

        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            // Try to parse HTTP request. Wait for \r\n\r\n or end of headers
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;

            const headerText = buffer.slice(0, headerEnd).toString('utf8');
            const headers = this.parseHttpHeaders(headerText);
            const bodyStart = headerEnd + 4;

            // If Content-Length present, ensure we have full body; otherwise
            // treat everything after the headers as the body (some IPP clients
            // — notably the Windows IPP Class Driver — omit Content-Length).
            const contentLength = parseInt(headers['content-length'] || '0', 10);
            const hasContentLength = 'content-length' in headers;
            if (hasContentLength && buffer.length < bodyStart + contentLength) return;

            const bodyEnd = hasContentLength ? bodyStart + contentLength : buffer.length;
            const body = buffer.slice(bodyStart, bodyEnd);
            if (body.length === 0) {
                logger.warn(`[IPP] ${peer} sent empty body (headers only), ignoring`);
                this.sendHttpError(socket, 400, 'Bad Request: empty IPP body');
                return;
            }
            logger.info(`[IPP] ${peer} body.length=${body.length} declared content-length=${contentLength} first32hex=${body.slice(0, 32).toString('hex')}`);
            this.handleRequest(socket, headers, body, peer);
        });

        socket.on('error', (err) => {
            logger.warn(`[IPP] Socket error from ${peer}: ${err.message}`);
        });
    }

    private parseHttpHeaders(text: string): Record<string, string> {
        const lines = text.split('\r\n');
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
            const idx = lines[i].indexOf(':');
            if (idx > 0) {
                const key = lines[i].slice(0, idx).trim().toLowerCase();
                const value = lines[i].slice(idx + 1).trim();
                headers[key] = value;
            }
        }
        return headers;
    }

    // ── Request handler ─────────────────────────────────────────────────────

    private async handleRequest(socket: net.Socket, headers: Record<string, string>, body: Buffer, peer: string) {
        // IPP comes over HTTP/1.1 POST with content-type "application/ipp"
        if (headers['content-type'] !== 'application/ipp') {
            this.sendHttpError(socket, 415, 'Content-Type must be application/ipp');
            return;
        }

        try {
            // ipp.parse returns { version, operation (string name), id (request-id), 'operation-attributes-tag', ... }
            // The op name → numeric op mapping uses ipp.operations
            const ippRequest: any = ipp.parse(body);
            const op: number = this.resolveOpId(ippRequest.operation);
            const requestId: number = ippRequest.id || 1;
            const opName = ippRequest.operation || `0x${op.toString(16)}`;

            logger.info(`[IPP] ${peer} op=${opName} (0x${op.toString(16).padStart(4, '0')}) reqId=${requestId}`);

            // Tag the request with op/requestId so helpers can reference them
            ippRequest.opCode = op;
            ippRequest.requestId = requestId;

            let responseBuffer: Buffer;
            switch (op) {
                case OP.GET_PRINTERS:
                    responseBuffer = await this.handleGetPrinters(ippRequest);
                    break;
                case OP.GET_PRINTER_ATTRIBUTES:
                    responseBuffer = await this.handleGetPrinterAttributes(ippRequest);
                    break;
                case OP.PRINT_JOB:
                    responseBuffer = await this.handlePrintJob(ippRequest, body);
                    break;
                case OP.PRINT_URI:
                    responseBuffer = await this.handlePrintURI(ippRequest, body);
                    break;
                case OP.VALIDATE_JOB:
                    responseBuffer = this.simpleResponse(op, STATUS.OK);
                    break;
                default:
                    logger.warn(`[IPP] Unsupported operation 0x${op.toString(16)} from ${peer}`);
                    responseBuffer = this.simpleResponse(op, STATUS.SERVER_ERROR + '-operation-not-supported');
            }

            this.sendHttpResponse(socket, responseBuffer);
        } catch (err) {
            logger.error(`[IPP] Failed to handle request from ${peer}: ${(err as Error).message}`);
            this.sendHttpError(socket, 500, 'Internal IPP error');
        }
    }

    // ── IPP operation handlers ──────────────────────────────────────────────

    private async handleGetPrinters(req: any): Promise<Buffer> {
        const knex = this.getKnex();
        // List printers bound to a node (have client_id) — those are the ones we can route.
        // Exclude auto-removed printers (15 min offline) so iPhone/Mac don't see ghosts.
        const printers: any[] = await knex('printers')
            .leftJoin('clients', 'printers.client_id', 'clients.id')
            .select('printers.*', 'clients.hostname as client_hostname', 'clients.ip_address as client_ip')
            .whereNotNull('printers.client_id')
            .whereRaw("(printers.config->>'auto_removed') IS DISTINCT FROM 'true'");

        // Build IPP response
        const buf = this.buildResponse(req.operationId, STATUS.OK, (encoder) => {
            // printer-attributes-tag group
            for (const p of printers) {
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-name', p.name);
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-uri-supported', this.printerURI(p));
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-make-and-model', (p as any).driver || 'Generic');
                encoder.addAttr('printer-attributes-tag', SYNTAX.ENUM, 'printer-state', p.status === 'online' ? 3 : 5);
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-info', `Bound to node: ${p.client_hostname || 'unknown'}`);
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-location', p.client_ip || '');
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'application/octet-stream');
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'application/postscript');
                encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'text/plain');
            }
        });
        return buf;
    }

    private async handleGetPrinterAttributes(req: any): Promise<Buffer> {
        const printerURI = this.extractAttr(req, 'printer-uri') || '';
        const printer: any = await this.findPrinterByURI(printerURI);

        if (!printer) {
            return this.simpleResponse(req.requestId, STATUS.CLIENT_ERROR_NOT_FOUND);
        }

        return this.buildResponse(req.requestId, STATUS.OK, (encoder) => {
            encoder.addAttr('printer-attributes-tag', SYNTAX.URI, 'printer-uri-supported', this.printerURI(printer));
            encoder.addAttr('printer-attributes-tag', SYNTAX.URI, 'printer-device-id', '');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-name', printer.name);
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-info', `PrintServer node-bound printer`);
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-make-and-model', (printer as any).driver || 'Generic');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-location', (printer as any).client_ip || '');
            encoder.addAttr('printer-attributes-tag', SYNTAX.ENUM, 'printer-state', printer.status === 'online' ? 3 : 5);
            encoder.addAttr('printer-attributes-tag', SYNTAX.ENUM, 'printer-is-accepting-jobs', 1);
            // printer-state-reasons: required by Windows IPP Class Driver to
            // determine printer availability.  'none' = ready; without this
            // attribute Windows treats the printer as unknown/unavailable.
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'printer-state-reasons', 'none');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-default', 'application/octet-stream');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'application/octet-stream');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'application/postscript');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'application/pdf');
            encoder.addAttr('printer-attributes-tag', SYNTAX.KEYWORD, 'document-format-supported', 'text/plain');
            encoder.addAttr('printer-attributes-tag', SYNTAX.NAME_WITHOUT_LANG, 'charset-configured', 'utf-8');
            encoder.addAttr('printer-attributes-tag', SYNTAX.NAME_WITHOUT_LANG, 'natural-language-configured', 'en');
            encoder.addAttr('printer-attributes-tag', SYNTAX.RANGE, 'copies-supported', '1-99');
        });
    }

    private async handlePrintJob(req: any, rawBody: Buffer): Promise<Buffer> {
        const printerURI = this.extractAttr(req, 'printer-uri') || '';
        const printer: any = await this.findPrinterByURI(printerURI);

        if (!printer) {
            return this.simpleResponse(req.requestId, STATUS.CLIENT_ERROR_NOT_FOUND);
        }
        if (printer.status !== 'online') {
            return this.simpleResponse(req.requestId, STATUS.CLIENT_ERROR + '-printer-not-ready');
        }

        // Extract document data (after IPP attributes, ends at EOF)
        const docOffset = req.dataOffset || rawBody.length;
        const docData = rawBody.slice(docOffset);
        const fileName = this.extractAttr(req, 'document-name') || `ipp-job-${Date.now()}`;
        const copies = parseInt(this.extractAttr(req, 'copies') || '1', 10);

        // Extract IPP print-job-template attributes (RFC 8011 §5.2)
        const media = this.extractAttr(req, 'media');
        const orientation = this.extractAttr(req, 'orientation-requested');
        const printColorMode = this.extractAttr(req, 'print-color-mode');
        const printSides = this.extractAttr(req, 'print-sides');
        const outputBin = this.extractAttr(req, 'output-bin');

        // Resolve effective paper config: IPP media takes precedence over
        // per-printer override, which takes precedence over server default.
        const paper = await this.resolveJobPaper(printer.id, {
            media, // may be 'iso_a4_210x297mm', 'na_letter_8.5x11in', 'custom_WxHmm', etc.
            orientation: this.ippOrientationToString(orientation),
            sides: printSides,  // 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge'
            color: printColorMode === 'color',
        });

        logger.info(`[IPP] Print-Job: printer=${printer.name} (id=${printer.id}) file=${fileName} copies=${copies} bytes=${docData.length} paper=${paper?.size || 'printer-default'}`);

        // Insert job into DB for tracking
        const knex = this.getKnex();
        const [job] = await knex('print_jobs')
            .insert({
                user_id: 1,
                client_id: printer.client_id,
                printer_id: printer.id,
                job_name: fileName,
                file_name: fileName,
                file_path: 'ipp-stream',
                file_type: 'raw',
                file_size: docData.length,
                paper_size: paper?.size || 'Default', // SIMPAN UKURAN KERTAS
                copies: copies,
                status: 'processing',
                priority: 'normal',
                source_app: 'ipp-client',
                started_at: new Date()
            })
            .returning(['id', 'job_id']);

        // Forward to agent
        try {
            const base64Data = docData.toString('base64');
            const result = await this.forwardToAgent(printer.client_id, {
                action: 'print',
                printerName: printer.name,
                fileName,
                copies,
                fileType: 'raw',
                fileData: base64Data,
                paper, // { size, orientation, customWidthMm, customHeightMm, tray } or null
            });

            await knex('print_jobs')
                .where({ id: job.id })
                .update({
                    status: result.success ? 'completed' : 'failed',
                    error_message: result.success ? null : result.error,
                    completed_at: new Date()
                });

            if (!result.success) {
                await knex('alerts')
                    .insert({
                        printer_id: job.printer_id,
                        type: 'job_failed',
                        severity: 'error',
                        title: 'Print Job Failed',
                        message: `Print job "${job.job_name || job.file_name}" failed on printer. Error: ${result.error || 'Unknown printer error'}`
                    });
            }

            if (result.success) {
                return this.buildResponse(req.requestId, STATUS.OK, (encoder) => {
                    encoder.addAttr('job-attributes-tag', SYNTAX.INTEGER, 'job-id', job.id);
                    encoder.addAttr('job-attributes-tag', SYNTAX.URI, 'job-uri', `ipp://${process.env.SERVER_IP || 'localhost'}:${IPP_PORT}/jobs/${job.id}`);
                    encoder.addAttr('job-attributes-tag', SYNTAX.ENUM, 'job-state', 5); // completed
                });
            } else {
                return this.simpleResponse(req.requestId, STATUS.SERVER_ERROR_INTERNAL);
            }
        } catch (err) {
            await knex('print_jobs')
                .where({ id: job.id })
                .update({ status: 'failed', error_message: (err as Error).message, completed_at: new Date() });
            
            await knex('alerts')
                .insert({
                    printer_id: job.printer_id,
                    type: 'job_failed',
                    severity: 'error',
                    title: 'Agent Print Error',
                    message: `Failed to forward job "${job.job_name || job.file_name}" to agent. Error: ${(err as Error).message}`
                });

            logger.error(`[IPP] Agent forward failed: ${(err as Error).message}`);
            return this.simpleResponse(req.requestId, STATUS.SERVER_ERROR_INTERNAL);
        }
    }

    private async handlePrintURI(req: any, rawBody: Buffer): Promise<Buffer> {
        // Print-URI is a reference to a URL — for our purposes we just accept and route
        return this.handlePrintJob(req, rawBody);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Map IPP operation name (e.g. "Get-Printer-Attributes") → numeric op code.
     * The ipp package provides this lookup via ipp.operations[opName] = opId.
     */
    private resolveOpId(opName: string): number {
        if (!opName) return 0;
        const ops = (ipp as any).operations;
        if (ops && typeof ops[opName] === 'number') return ops[opName];
        if (ops && Array.isArray(ops.lookup)) {
            const idx = ops.lookup.indexOf(opName);
            if (idx >= 0) return idx;
        }
        if (ops) {
            for (const k of Object.keys(ops)) {
                if (k.toLowerCase() === opName.toLowerCase()) return Number(ops[k]);
            }
        }
        return 0;
    }

    private printerURI(p: any): string {
        const serverIp = process.env.SERVER_IP || 'localhost';
        const slug = p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return `ipp://${serverIp}:${IPP_PORT}/printers/${slug}`;
    }

    private async findPrinterByURI(uri: string): Promise<PrinterRecord | null> {
        if (!uri) return null;
        const match = uri.match(/\/printers\/([^/?]+)/);
        const slug = match ? match[1].toLowerCase() : null;

        const knex = this.getKnex();
        const printers = await knex('printers')
            .leftJoin('clients', 'printers.client_id', 'clients.id')
            .select('printers.*', 'clients.ip_address as client_ip')
            .whereNotNull('printers.client_id');

        // Try by slug, then by name (case-insensitive)
        let printer = printers.find((p: any) => (p.slug || '').toLowerCase() === slug);
        if (!printer) {
            printer = printers.find((p: any) => p.name.toLowerCase() === (slug || '').replace(/-/g, ' '));
        }
        if (!printer && slug) {
            printer = printers.find((p: any) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug);
        }
        return printer || null;
    }

    private extractAttr(req: any, name: string): string | null {
        // ipp.parse returns attrs in groups like 'operation-attributes-tag', 'job-attributes-tag', etc.
        // as flat key→value objects. Search across all groups.
        if (!req) return null;
        const attrs = req.attributes; // legacy structure
        if (attrs) {
            for (const group of Object.values(attrs) as any[]) {
                if (Array.isArray(group)) {
                    for (const a of group) {
                        if (a.name === name) return String(a.value);
                    }
                }
            }
        }
        // Real structure from ipp.parse: each group is a top-level key
        for (const key of Object.keys(req)) {
            if (key.endsWith('-tag') || key === 'attributes') {
                const group = req[key];
                if (group && typeof group === 'object' && !Array.isArray(group)) {
                    if (group[name] !== undefined) return String(group[name]);
                }
            }
        }
        return null;
    }

    // ── IPP response builder ────────────────────────────────────────────────

    private buildResponse(reqOp: number, statusCode: string, fillAttrs: (encoder: any) => void): Buffer {
        const encoder = new IPPEncoder();
        encoder.addHeader(2, 0, statusCode, reqOp, 1);
        fillAttrs(encoder);
        encoder.addDelimiter('printer-attributes-tag');
        return encoder.toBuffer();
    }

    private simpleResponse(reqOp: number, statusCode: string): Buffer {
        return this.buildResponse(reqOp, statusCode, () => {});
    }

    /**
     * Convert an IPP `orientation-requested` enum (RFC 8011 §5.2.10) to
     * a string we can pass through to the agent/PowerShell.
     */
    private ippOrientationToString(ippValue: string | null): 'portrait' | 'landscape' | null {
        if (!ippValue) return null;
        // Values 3=portrait, 4=landscape, 5=reverse-landscape, 6=reverse-portrait
        if (ippValue === '4' || ippValue === '5' || /^reverse-landscape/.test(ippValue)) return 'landscape';
        return 'portrait';
    }

    /**
     * Resolve paper config for a job: start from per-printer/server default,
     * then apply IPP request overrides (media, orientation).
     */
    private async resolveJobPaper(printerId: number, ippAttrs: {
        media?: string | null;
        orientation?: 'portrait' | 'landscape' | null;
        sides?: string | null;
        color?: boolean;
    }): Promise<any | null> {
        // Lazy import to avoid a hard module-load dependency cycle
        const { resolvePaperForPrinter } = await import('./paper-service.js');
        const base = await resolvePaperForPrinter(this.getKnex(), printerId);

        if (!ippAttrs.media) {
            return ippAttrs.orientation ? { ...base, orientation: ippAttrs.orientation } : base;
        }

        // Map IPP media keyword back to a friendly name
        const all = await (await import('./paper-service.js')).listPaperSizes(this.getKnex());
        const ippLower = ippAttrs.media.toLowerCase();

        // Try reverse lookup of builtin names
        const reverseBuiltin: Record<string, string> = {
            'iso_a3_297x420mm': 'A3', 'iso_a4_210x297mm': 'A4', 'iso_a5_148x210mm': 'A5',
            'iso_a6_105x148mm': 'A6', 'jis_b4_257x364mm': 'B4', 'jis_b5_182x257mm': 'B5',
            'na_letter_8.5x11in': 'Letter', 'na_legal_8.5x14in': 'Legal',
            'na_tabloid_11x17in': 'Tabloid', 'na_executive_7.25x10.5in': 'Executive',
            'na_foolscap_8.5x13in': 'Folio', 'na_invoice_5.5x8.5in': 'Statement',
        };
        const builtinName = reverseBuiltin[ippLower];
        if (builtinName && all.find((p) => p.name === builtinName)) {
            return {
                ...base,
                size: builtinName,
                orientation: ippAttrs.orientation || base.orientation,
            };
        }

        // Custom: parse 'custom_<W>x<H>mm' or 'custom_<W>x<H>in'
        const customMatch = ippLower.match(/^custom_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$/);
        if (customMatch) {
            const w = parseFloat(customMatch[1]);
            const h = parseFloat(customMatch[2]);
            const unit = customMatch[3];
            const widthMm = unit === 'in' ? w * 25.4 : w;
            const heightMm = unit === 'in' ? h * 25.4 : h;
            // Look up by name in our custom list; if not found, create transient entry
            const matched = all.find((p) => !p.builtin
                && Math.abs(p.widthMm - widthMm) < 0.5
                && Math.abs(p.heightMm - heightMm) < 0.5);
            return {
                ...base,
                size: matched?.name || 'Custom',
                customWidthMm: widthMm,
                customHeightMm: heightMm,
                orientation: ippAttrs.orientation || base.orientation,
            };
        }

        // Unknown keyword → fall through to base
        return base;
    }

    private sendHttpResponse(socket: net.Socket, body: Buffer) {
        const headers = [
            'HTTP/1.1 200 OK',
            'Content-Type: application/ipp',
            `Content-Length: ${body.length}`,
            'Connection: close',
            '',
            ''
        ].join('\r\n');
        socket.write(Buffer.concat([Buffer.from(headers, 'utf8'), body]));
        socket.end();
    }

    private sendHttpError(socket: net.Socket, code: number, message: string) {
        const body = JSON.stringify({ error: message });
        const headers = [
            `HTTP/1.1 ${code} ${message}`,
            'Content-Type: application/json',
            `Content-Length: ${body.length}`,
            'Connection: close',
            '',
            ''
        ].join('\r\n');
        socket.write(Buffer.concat([Buffer.from(headers, 'utf8'), Buffer.from(body, 'utf8')]));
        socket.end();
    }
}

// ─── IPP binary encoder ──────────────────────────────────────────────────────

class IPPEncoder {
    private chunks: Buffer[] = [];
    private currentGroup = '';

    addHeader(versionMajor: number, versionMinor: number, statusCode: string, opId: number, reqId: number) {
        // Version (2 bytes) + Status (2 bytes) + Request ID (4 bytes)
        this.chunks.push(Buffer.from([versionMajor, versionMinor]));
        this.chunks.push(Buffer.from(this.encodeInt16(this.statusCodeToInt(statusCode))));
        this.chunks.push(Buffer.from(this.encodeInt32(reqId)));
    }

    addDelimiter(groupName: string) {
        this.chunks.push(Buffer.from([0x03])); // end-of-attributes-tag
        this.currentGroup = groupName;
    }

    addAttr(group: string, syntax: number, name: string, value: any) {
        // Set delimiter on first attr of new group
        if (this.currentGroup !== group) {
            // No-op: spec allows multiple groups in single response
        }
        this.chunks.push(Buffer.from([syntax])); // value tag
        this.chunks.push(Buffer.from(this.encodeString(name)));
        this.chunks.push(this.encodeAttrValue(syntax, value));
    }

    toBuffer(): Buffer {
        return Buffer.concat(this.chunks);
    }

    private statusCodeToInt(code: string): number {
        const m: Record<string, number> = {
            'successful-ok': 0x0000,
            'successful-ok-ignored-or-substituted-attributes': 0x0001,
            'client-error-bad-request': 0x0400,
            'client-error-not-found': 0x0404,
            'client-error-uri-scheme-not-supported': 0x0401,
            'client-error-printer-not-ready': 0x0412,
            'server-error-internal-error': 0x0500,
            'server-error-operation-not-supported': 0x0501
        };
        return m[code] ?? 0x0500;
    }

    private encodeInt16(n: number): number[] {
        return [(n >> 8) & 0xff, n & 0xff];
    }
    private encodeInt32(n: number): number[] {
        return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }
    private encodeString(s: string): number[] {
        const bytes = Buffer.from(s, 'utf8');
        const len = bytes.length;
        return [(len >> 8) & 0xff, len & 0xff, ...Array.from(bytes)];
    }
    private encodeAttrValue(syntax: number, value: any): Buffer {
        switch (syntax) {
            case SYNTAX.INTEGER:
            case SYNTAX.ENUM: {
                const n = parseInt(value, 10);
                return Buffer.from(this.encodeInt32(n));
            }
            case SYNTAX.BOOLEAN:
                return Buffer.from([value ? 1 : 0]);
            case SYNTAX.RANGE: {
                const parts = String(value).split('-');
                const lo = parseInt(parts[0], 10) || 1;
                const hi = parseInt(parts[1] || parts[0], 10) || lo;
                return Buffer.from(this.encodeInt32(lo) as any).length === 4
                    ? Buffer.from([...this.encodeInt32(lo), ...this.encodeInt32(hi)])
                    : Buffer.from([]);
            }
            case SYNTAX.URI:
            case SYNTAX.KEYWORD:
            case SYNTAX.NAME_WITHOUT_LANG:
            case SYNTAX.TEXT_WITHOUT_LANG:
            case SYNTAX.OCTET_STRING: {
                return Buffer.from(this.encodeString(String(value)));
            }
            default:
                return Buffer.from(this.encodeString(String(value)));
        }
    }
}
