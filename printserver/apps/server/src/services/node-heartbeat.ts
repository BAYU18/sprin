/**
 * PrintServer Pro - Node Heartbeat Service
 * Windows Node side - auto-registers with Central Hub and sends heartbeats
 */

import { FastifyInstance } from 'fastify';
import axios, { AxiosInstance } from 'axios';
import os from 'os';
import { logger } from '../utils/logger.js';
import { WindowsPrinterDriver } from '../printer-engine/drivers/windows-driver.js';

interface PrinterInfo {
    name: string;
    status: string;
    jobs_in_queue: number;
}

interface HeartbeatPayload {
    printers: PrinterInfo[];
    stats: {
        printers_online: number;
        printers_offline: number;
        jobs_in_queue: number;
        active_jobs: number;
        cpu_usage: string;
        memory_usage: string;
    };
}

interface RegistrationPayload {
    node_name: string;
    hostname: string;
    ip_address: string;
    mac_address: string;
    os_version: string;
    api_url: string;
    printers: Array<{
        name: string;
        driver: string;
        port: string;
        type: string;
        capabilities: any;
    }>;
}

export class NodeHeartbeatService {
    private fastify: FastifyInstance;
    private centralHubUrl: string;
    private nodeSecret: string;
    private nodeName: string;
    private nodeId: number | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private centralClient: AxiosInstance | null = null;
    private isRunning: boolean = false;
    private retryCount: number = 0;
    private maxRetries: number = 10;
    private baseRetryDelay: number = 1000;
    private maxRetryDelay: number = 60000;
    private isRegistered: boolean = false;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.centralHubUrl = process.env.CENTRAL_HUB_URL || '';
        this.nodeSecret = process.env.NODE_SECRET || '';
        this.nodeName = process.env.NODE_NAME || os.hostname();
    }

    /**
     * Calculate delay with exponential backoff
     */
    private getRetryDelay(): number {
        const delay = Math.min(
            this.baseRetryDelay * Math.pow(2, this.retryCount),
            this.maxRetryDelay
        );
        return delay;
    }

    /**
     * Get node's IP address
     */
    private getNodeIpAddress(): string {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }

    /**
     * Get node's MAC address
     */
    private getNodeMacAddress(): string {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'MAC' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '';
    }

    /**
     * Get system stats (CPU/Memory usage)
     */
    private getSystemStats(): { cpu_usage: string; memory_usage: string } {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type as keyof typeof cpu.times];
            }
            totalIdle += cpu.times.idle;
        }

        const cpuUsage = totalTick > 0
            ? `${Math.round((1 - totalIdle / totalTick) * 100)}%`
            : '0%';

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memoryUsage = `${Math.round(((totalMem - freeMem) / totalMem) * 100)}%`;

        return { cpu_usage: cpuUsage, memory_usage: memoryUsage };
    }

    /**
     * Scan local printers and get their status
     */
    private async scanPrinters(): Promise<PrinterInfo[]> {
        try {
            const driver = new WindowsPrinterDriver(this.fastify, {
                id: 0,
                name: 'scanner',
                type: 'windows'
            });
            await driver.initialize();

            const printers = await driver.getPrinterList();

            return printers.map(p => ({
                name: p.Name,
                status: p.IsOnline ? 'online' : 'offline',
                jobs_in_queue: p.JobsInQueue || 0
            }));
        } catch (error) {
            logger.error('[NodeHeartbeat] Failed to scan printers:', error);
            return [];
        }
    }

    /**
     * Auto-register this node with Central Hub
     */
    async register(): Promise<boolean> {
        if (!this.centralHubUrl) {
            logger.warn('[NodeHeartbeat] CENTRAL_HUB_URL not set, skipping registration');
            return false;
        }

        try {
            const printers = await this.scanPrinters();

            const payload: RegistrationPayload = {
                node_name: this.nodeName,
                hostname: os.hostname(),
                ip_address: this.getNodeIpAddress(),
                mac_address: this.getNodeMacAddress(),
                os_version: os.release(),
                api_url: `http://${this.getNodeIpAddress()}:${process.env.PORT || 3000}`,
                printers: printers.map(p => ({
                    name: p.name,
                    driver: '',
                    port: '',
                    type: 'windows',
                    capabilities: {}
                }))
            };

            logger.info(`[NodeHeartbeat] Registering with Central Hub: ${this.centralHubUrl}`);

            const response = await axios.post(`${this.centralHubUrl}/api/nodes/register`, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data.success) {
                this.nodeId = response.data.node_id;
                this.nodeSecret = response.data.secret_key || this.nodeSecret;
                this.isRegistered = true;

                this.centralClient = axios.create({
                    baseURL: this.centralHubUrl,
                    timeout: 30000,
                    headers: {
                        'X-Node-Secret': this.nodeSecret
                    }
                });

                logger.info(`[NodeHeartbeat] Registered successfully. Node ID: ${this.nodeId}`);
                this.retryCount = 0;
                return true;
            }

            logger.warn('[NodeHeartbeat] Registration response not successful');
            return false;
        } catch (error: any) {
            logger.error('[NodeHeartbeat] Registration failed:', error.message);
            return false;
        }
    }

    /**
     * Send heartbeat to Central Hub with exponential backoff
     */
    private async sendHeartbeat(): Promise<boolean> {
        if (!this.centralClient || !this.nodeId) {
            logger.warn('[NodeHeartbeat] Not registered, attempting registration...');
            const registered = await this.register();
            if (!registered) {
                this.retryCount++;
                const delay = this.getRetryDelay();
                logger.info(`[NodeHeartbeat] Will retry registration in ${delay}ms`);
                await this.sleep(delay);
            }
            return registered;
        }

        try {
            const printers = await this.scanPrinters();
            const stats = this.getSystemStats();

            const printersOnline = printers.filter(p => p.status === 'online').length;
            const printersOffline = printers.filter(p => p.status === 'offline').length;
            const jobsInQueue = printers.reduce((sum, p) => sum + (p.jobs_in_queue || 0), 0);

            const payload: HeartbeatPayload = {
                printers: printers.map(p => ({
                    name: p.name,
                    status: p.status,
                    jobs_in_queue: p.jobs_in_queue
                })),
                stats: {
                    printers_online: printersOnline,
                    printers_offline: printersOffline,
                    jobs_in_queue: jobsInQueue,
                    active_jobs: 0,
                    cpu_usage: stats.cpu_usage,
                    memory_usage: stats.memory_usage
                }
            };

            const response = await this.centralClient.post(
                `/api/nodes/${this.nodeId}/heartbeat`,
                payload
            );

            if (response.data.success) {
                logger.debug(`[NodeHeartbeat] Heartbeat sent, ${printers.length} printers reported`);
                this.retryCount = 0;
                return true;
            }

            return false;
        } catch (error: any) {
            logger.error('[NodeHeartbeat] Heartbeat failed:', error.message);
            this.retryCount++;

            if (this.retryCount >= this.maxRetries) {
                logger.error('[NodeHeartbeat] Max retries reached, marking for reduced frequency');

                if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    logger.warn('[NodeHeartbeat] Central Hub unreachable, will continue with periodic retries');
                }
            } else {
                const delay = this.getRetryDelay();
                logger.info(`[NodeHeartbeat] Retrying heartbeat in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
                await this.sleep(delay);
            }

            if (this.retryCount >= this.maxRetries) {
                this.isRegistered = false;
                this.centralClient = null;
            }

            return false;
        }
    }

    /**
     * Sleep utility for retry delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Start the heartbeat service
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('[NodeHeartbeat] Already running');
            return;
        }

        logger.info('[NodeHeartbeat] Starting Node Heartbeat Service...');

        const registered = await this.register();

        if (!registered && this.centralHubUrl) {
            logger.warn('[NodeHeartbeat] Initial registration failed, will retry with heartbeats');
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                await this.sendHeartbeat();
            } catch (error) {
                logger.error('[NodeHeartbeat] Heartbeat loop error:', error);
            }
        }, 30000);

        this.isRunning = true;
        logger.info('[NodeHeartbeat] Service started successfully');
    }

    /**
     * Stop the heartbeat service
     */
    async stop(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        this.isRunning = false;
        logger.info('[NodeHeartbeat] Service stopped');
    }

    /**
     * Get service status
     */
    getStatus(): { isRunning: boolean; nodeId: number | null; retryCount: number; isRegistered: boolean } {
        return {
            isRunning: this.isRunning,
            nodeId: this.nodeId,
            retryCount: this.retryCount,
            isRegistered: this.isRegistered
        };
    }
}

export default NodeHeartbeatService;