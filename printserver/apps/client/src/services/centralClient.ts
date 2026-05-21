/**
 * PrintServer Pro - Central Hub Client for Electron Agent
 * Fetches printer list from Central Hub and handles job submission
 */

import axios, { AxiosInstance } from 'axios';
import log from 'electron-log';
import Store from 'electron-store';

export interface Printer {
    id: number;
    name: string;
    driver: string;
    port: string;
    type: string;
    status: string;
    is_shared: boolean;
    share_name: string | null;
    is_default: boolean;
    group_id: number | null;
    group_name: string | null;
    node_id: number | null;
    node_name: string | null;
    api_url: string | null;
}

export interface NodeInfo {
    node_id: number;
    node_name: string;
    api_url: string;
    status: string;
    printers: Printer[];
}

export interface CentralDiscoveryResponse {
    printers: Printer[];
    grouped_by_node: NodeInfo[];
    total: number;
    nodes_online: number;
}

export class CentralClient {
    private client: AxiosInstance;
    private store: Store;
    private cachedPrinters: Printer[] = [];
    private cachedNodes: NodeInfo[] = [];
    private lastFetch: Date | null = null;
    private cacheTimeout: number = 60000;

    constructor(store: Store) {
        this.store = store;
        const baseURL = store.get('serverUrl') || 'http://localhost:3000';

        this.client = axios.create({
            baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        log.info('[CentralClient] Initialized with base URL:', baseURL);
    }

    /**
     * Update base URL dynamically
     */
    setBaseURL(url: string): void {
        this.client = axios.create({
            baseURL: url,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        log.info('[CentralClient] Base URL updated to:', url);
    }

    /**
     * Check if cache is still valid
     */
    private isCacheValid(): boolean {
        if (!this.lastFetch) return false;
        return (Date.now() - this.lastFetch.getTime()) < this.cacheTimeout;
    }

    /**
     * Fetch all printers from Central Hub via discovery API
     */
    async fetchPrinters(forceRefresh: boolean = false): Promise<Printer[]> {
        if (this.isCacheValid() && !forceRefresh) {
            log.debug('[CentralClient] Returning cached printers');
            return this.cachedPrinters;
        }

        try {
            const response = await this.client.get<CentralDiscoveryResponse>('/api/discovery/printers');

            if (response.data && response.data.printers) {
                this.cachedPrinters = response.data.printers;
                this.cachedNodes = response.data.grouped_by_node || [];
                this.lastFetch = new Date();

                log.info(`[CentralClient] Fetched ${this.cachedPrinters.length} printers from ${response.data.nodes_online} nodes`);

                return this.cachedPrinters;
            }

            return [];
        } catch (error: any) {
            log.error('[CentralClient] Failed to fetch printers:', error.message);
            throw error;
        }
    }

    /**
     * Get printers grouped by node
     */
    async fetchNodes(): Promise<NodeInfo[]> {
        try {
            const response = await this.client.get<CentralDiscoveryResponse>('/api/discovery/printers');

            this.cachedNodes = response.data.grouped_by_node || [];
            this.cachedPrinters = response.data.printers || [];
            this.lastFetch = new Date();

            return this.cachedNodes;
        } catch (error: any) {
            log.error('[CentralClient] Failed to fetch nodes:', error.message);
            throw error;
        }
    }

    /**
     * Get printer list filtered by node or group
     */
    async getPrintersByNode(nodeId?: number): Promise<Printer[]> {
        const printers = await this.fetchPrinters();

        if (nodeId !== undefined) {
            return printers.filter(p => p.node_id === nodeId);
        }

        return printers;
    }

    /**
     * Get printer list filtered by group
     */
    async getPrintersByGroup(groupId: number): Promise<Printer[]> {
        const printers = await this.fetchPrinters();
        return printers.filter(p => p.group_id === groupId);
    }

    /**
     * Get default printer for this client
     */
    async getDefaultPrinter(): Promise<Printer | null> {
        const printers = await this.fetchPrinters();

        const storedPrinterId = this.store.get('defaultPrinterId');
        if (storedPrinterId) {
            const stored = printers.find(p => p.id === storedPrinterId);
            if (stored) {
                log.debug('[CentralClient] Using stored default printer:', stored.name);
                return stored;
            }
        }

        const defaultPrinter = printers.find(p => p.is_default) || printers[0];

        if (defaultPrinter) {
            this.store.set('defaultPrinterId', defaultPrinter.id);
            log.debug('[CentralClient] Auto-selected default printer:', defaultPrinter.name);
        }

        return defaultPrinter || null;
    }

    /**
     * Set default printer for this client
     */
    setDefaultPrinter(printerId: number): void {
        this.store.set('defaultPrinterId', printerId);
        log.info('[CentralClient] Default printer set to ID:', printerId);
    }

    /**
     * Submit print job to Central Hub
     */
    async submitJob(job: {
        filePath: string;
        fileName: string;
        fileType: string;
        pages?: number;
        copies?: number;
        printerId?: number;
        options?: any;
    }): Promise<{ jobId: string; success: boolean }> {
        try {
            let targetPrinterId = job.printerId;

            if (!targetPrinterId) {
                const defaultPrinter = await this.getDefaultPrinter();
                if (!defaultPrinter) {
                    throw new Error('No printer selected and no default available');
                }
                targetPrinterId = defaultPrinter.id;
            }

            const FormData = (await import('form-data')).default;
            const fs = await import('fs');

            const formData = new FormData();
            formData.append('file', fs.createReadStream(job.filePath));
            formData.append('printerId', targetPrinterId.toString());
            formData.append('jobName', job.fileName);
            formData.append('fileType', job.fileType);
            formData.append('pages', (job.pages || 1).toString());
            formData.append('copies', (job.copies || 1).toString());
            formData.append('options', JSON.stringify(job.options || {}));

            if (this.store.get('clientToken')) {
                this.client = axios.create({
                    baseURL: this.store.get('serverUrl'),
                    timeout: 60000,
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.store.get('clientToken')}`
                    }
                });
            }

            const response = await this.client.post('/api/jobs/submit', formData, {
                headers: formData.getHeaders(),
                timeout: 120000
            });

            log.info('[CentralClient] Job submitted:', response.data);

            if (response.data.jobId) {
                this.store.set('lastPrinterId', targetPrinterId);
            }

            return response.data;
        } catch (error: any) {
            log.error('[CentralClient] Job submission failed:', error.message);
            throw error;
        }
    }

    /**
     * Check Central Hub health
     */
    async checkHealth(): Promise<boolean> {
        try {
            const response = await this.client.get('/health', { timeout: 5000 });
            return response.data.status === 'ok';
        } catch {
            return false;
        }
    }

    /**
     * Get cached printers without refresh
     */
    getCachedPrinters(): Printer[] {
        return this.cachedPrinters;
    }

    /**
     * Get cached nodes without refresh
     */
    getCachedNodes(): NodeInfo[] {
        return this.cachedNodes;
    }
}

export default CentralClient;