/**
 * PrintServer Pro - Node Manager Service
 * Windows Node Connection and Routing Manager
 *
 * Manages Windows Node connections, routing, and failover for PrintServer Pro
 * Mobility Print feature support
 */

import { FastifyInstance } from 'fastify';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';

export interface NodePrinter {
    id: number;
    name: string;
    status: string;
    type: string;
}

export interface NodeInfo {
    nodeId: string;
    hostname: string;
    ip: string;
    printers: NodePrinter[];
    lastSeen: Date;
    status: 'online' | 'offline' | 'warning';
}

export interface NodeRegistrationData {
    hostname: string;
    ip: string;
    printers: NodePrinter[];
    osVersion?: string;
    apiVersion?: string;
}

export interface PrintJob {
    jobId: string;
    printerName: string;
    printerId: number;
    filePath: string;
    fileName: string;
    copies?: number;
    options?: Record<string, unknown>;
    priority?: 'low' | 'normal' | 'high';
}

export interface RouteResult {
    nodeId: string;
    nodeName: string;
    apiUrl: string;
    success: boolean;
    error?: string;
}

export interface NodeDocument {
    id: number;
    node_name: string;
    hostname: string;
    ip_address: string;
    mac_address: string | null;
    api_url: string;
    secret_key: string | null;
    status: 'online' | 'offline' | 'warning';
    os_version: string | null;
    api_version: string | null;
    metadata: Record<string, unknown> | null;
    last_heartbeat: Date | null;
    created_at: Date;
    updated_at: Date;
}

class NodeManager {
    private fastify: FastifyInstance;
    private nodesCache: Map<string, NodeInfo>;
    private printerToNodeCache: Map<string, string>;
    private nodeClients: Map<string, AxiosInstance>;
    private dbSyncInterval: NodeJS.Timeout | null = null;
    private heartbeatCheckInterval: NodeJS.Timeout | null = null;
    private readonly DB_SYNC_INTERVAL_MS = 60000;
    private readonly HEARTBEAT_CHECK_INTERVAL_MS = 30000;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.nodesCache = new Map();
        this.printerToNodeCache = new Map();
        this.nodeClients = new Map();
    }

    /**
     * Initialize Node Manager - load existing nodes from database
     */
    async initialize(): Promise<void> {
        await this.loadNodesFromDatabase();
        this.startPeriodicSync();
        this.startHeartbeatCheck();
        logger.info('[NodeManager] Initialized');
    }

    /**
     * Load all nodes from database into memory cache
     */
    private async loadNodesFromDatabase(): Promise<void> {
        try {
            const nodes = await this.fastify.knex<NodeDocument>('nodes').select('*');

            this.nodesCache.clear();
            this.printerToNodeCache.clear();
            this.nodeClients.clear();

            for (const node of nodes) {
                const printers = await this.getPrintersForNode(node.id);

                const nodeInfo: NodeInfo = {
                    nodeId: node.id.toString(),
                    hostname: node.hostname || node.node_name,
                    ip: node.ip_address || '',
                    printers,
                    lastSeen: node.last_heartbeat ? new Date(node.last_heartbeat) : new Date(0),
                    status: node.status as 'online' | 'offline' | 'warning'
                };

                this.nodesCache.set(node.id.toString(), nodeInfo);

                if (node.status === 'online' && node.api_url) {
                    this.createNodeClient(node);
                }

                for (const printer of printers) {
                    this.printerToNodeCache.set(`${printer.name.toLowerCase()}:${printer.id}`, node.id.toString());
                }
            }

            logger.info(`[NodeManager] Loaded ${nodes.length} nodes from database`);
        } catch (error) {
            logger.error('[NodeManager] Failed to load nodes from database:', error);
            throw error;
        }
    }

    /**
     * Get printers associated with a node
     */
    private async getPrintersForNode(nodeId: number): Promise<NodePrinter[]> {
        const printers = await this.fastify.knex('printers')
            .where('node_id', nodeId)
            .where('status', '!=', 'inactive')
            .select('id', 'name', 'status', 'type');

        return printers.map((p: any) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            type: p.type
        }));
    }

    /**
     * Create HTTP client for node communication
     */
    private createNodeClient(node: NodeDocument): void {
        if (!node.api_url) return;

        const client = axios.create({
            baseURL: node.api_url,
            timeout: 30000,
            headers: node.secret_key ? {
                'X-Node-Secret': node.secret_key
            } : {}
        });

        this.nodeClients.set(node.id.toString(), client);
    }

    /**
     * Start periodic database sync
     */
    private startPeriodicSync(): void {
        this.dbSyncInterval = setInterval(async () => {
            await this.syncNodesToDatabase();
        }, this.DB_SYNC_INTERVAL_MS);
    }

    /**
     * Start periodic heartbeat check for all nodes
     */
    private startHeartbeatCheck(): void {
        this.heartbeatCheckInterval = setInterval(async () => {
            await this.checkAllNodeHeartbeats();
        }, this.HEARTBEAT_CHECK_INTERVAL_MS);
    }

    /**
     * Sync node cache state to database
     */
    private async syncNodesToDatabase(): Promise<void> {
        try {
            for (const [nodeId, nodeInfo] of this.nodesCache) {
                const updateData: Record<string, unknown> = {
                    last_heartbeat: nodeInfo.lastSeen,
                    status: nodeInfo.status
                };

                await this.fastify.knex('nodes')
                    .where('id', parseInt(nodeId, 10))
                    .update(updateData);
            }
        } catch (error) {
            logger.error('[NodeManager] Failed to sync nodes to database:', error);
        }
    }

    /**
     * Check heartbeat status for all online nodes
     */
    private async checkAllNodeHeartbeats(): Promise<void> {
        for (const [nodeId, client] of this.nodeClients) {
            try {
                await client.get('/health', { timeout: 5000 });
                this.updateNodeStatus(nodeId, 'online');
            } catch {
                const nodeInfo = this.nodesCache.get(nodeId);
                if (nodeInfo && nodeInfo.status === 'online') {
                    logger.warn(`[NodeManager] Node ${nodeId} heartbeat failed, marking offline`);
                    await this.handleNodeOffline(nodeId);
                }
            }
        }
    }

    /**
     * Register a new node
     */
    async registerNode(nodeData: NodeRegistrationData): Promise<string> {
        try {
            const existingNode = await this.fastify.knex('nodes')
                .where('hostname', nodeData.hostname)
                .orWhere('ip_address', nodeData.ip)
                .first();

            if (existingNode) {
                await this.fastify.knex('nodes')
                    .where('id', existingNode.id)
                    .update({
                        status: 'online',
                        last_heartbeat: new Date(),
                        printers: JSON.stringify(nodeData.printers),
                        os_version: nodeData.osVersion,
                        api_version: nodeData.apiVersion
                    });

                const nodeId = existingNode.id.toString();
                await this.updateNodeStatus(nodeId, 'online');
                return nodeId;
            }

            const [newNode] = await this.fastify.knex('nodes')
                .insert({
                    node_name: nodeData.hostname,
                    hostname: nodeData.hostname,
                    ip_address: nodeData.ip,
                    status: 'online',
                    os_version: nodeData.osVersion,
                    api_version: nodeData.apiVersion,
                    api_url: '',
                    last_heartbeat: new Date()
                })
                .returning('*');

            const nodeId = newNode.id.toString();

            const nodeInfo: NodeInfo = {
                nodeId,
                hostname: nodeData.hostname,
                ip: nodeData.ip,
                printers: nodeData.printers,
                lastSeen: new Date(),
                status: 'online'
            };

            this.nodesCache.set(nodeId, nodeInfo);

            for (const printer of nodeData.printers) {
                this.printerToNodeCache.set(`${printer.name.toLowerCase()}:${printer.id}`, nodeId);
            }

            logger.info(`[NodeManager] Registered new node: ${nodeData.hostname} (ID: ${nodeId})`);
            return nodeId;
        } catch (error) {
            logger.error('[NodeManager] Failed to register node:', error);
            throw error;
        }
    }

    /**
     * Unregister a node (mark as offline)
     */
    async unregisterNode(nodeId: string): Promise<void> {
        try {
            const node = this.nodesCache.get(nodeId);

            if (node) {
                await this.fastify.knex('nodes')
                    .where('id', parseInt(nodeId, 10))
                    .update({ status: 'offline' });

                for (const printer of node.printers) {
                    this.printerToNodeCache.delete(`${printer.name.toLowerCase()}:${printer.id}`);
                }

                this.nodesCache.delete(nodeId);
                this.nodeClients.delete(nodeId);

                logger.info(`[NodeManager] Unregistered node: ${node.hostname}`);
            }
        } catch (error) {
            logger.error('[NodeManager] Failed to unregister node:', error);
            throw error;
        }
    }

    /**
     * Update node heartbeat status
     */
    async updateNodeStatus(nodeId: string, status: 'online' | 'offline' | 'warning'): Promise<void> {
        const node = this.nodesCache.get(nodeId);

        if (!node) {
            logger.warn(`[NodeManager] Node ${nodeId} not found for status update`);
            return;
        }

        node.status = status;
        node.lastSeen = new Date();

        if (status === 'offline' || status === 'warning') {
            this.nodeClients.delete(nodeId);
        }

        await this.fastify.knex('nodes')
            .where('id', parseInt(nodeId, 10))
            .update({
                status,
                last_heartbeat: node.lastSeen
            });
    }

    /**
     * Find node that has a specific printer
     */
    async getNodeForPrinter(printerName: string): Promise<NodeInfo | null> {
        for (const [, nodeInfo] of this.nodesCache) {
            if (nodeInfo.status !== 'online') continue;

            const printer = nodeInfo.printers.find(
                p => p.name.toLowerCase() === printerName.toLowerCase()
            );

            if (printer) {
                return nodeInfo;
            }
        }

        const printer = await this.fastify.knex('printers')
            .where('name', printerName)
            .where('status', '!=', 'inactive')
            .first();

        if (!printer) {
            return null;
        }

        const node = await this.fastify.knex('nodes')
            .where('id', printer.node_id)
            .where('status', 'online')
            .first();

        if (!node) {
            return null;
        }

        return this.nodesCache.get(node.id.toString()) || null;
    }

    /**
     * Get node by printer ID
     */
    async getNodeForPrinterId(printerId: number): Promise<NodeInfo | null> {
        for (const [, nodeInfo] of this.nodesCache) {
            if (nodeInfo.status !== 'online') continue;

            const printer = nodeInfo.printers.find(p => p.id === printerId);

            if (printer) {
                return nodeInfo;
            }
        }

        const printer = await this.fastify.knex('printers')
            .where('id', printerId)
            .where('status', '!=', 'inactive')
            .first();

        if (!printer || !printer.node_id) {
            return null;
        }

        const node = await this.fastify.knex('nodes')
            .where('id', printer.node_id)
            .where('status', 'online')
            .first();

        if (!node) {
            return null;
        }

        return this.nodesCache.get(node.id.toString()) || null;
    }

    /**
     * Find best node for print job considering online status and printer availability
     */
    async routeJob(job: PrintJob): Promise<RouteResult> {
        const targetNode = await this.getNodeForPrinter(job.printerName);

        if (!targetNode) {
            return {
                nodeId: '',
                nodeName: '',
                apiUrl: '',
                success: false,
                error: `No online node found with printer: ${job.printerName}`
            };
        }

        const client = this.nodeClients.get(targetNode.nodeId);

        if (!client) {
            return {
                nodeId: targetNode.nodeId,
                nodeName: targetNode.hostname,
                apiUrl: '',
                success: false,
                error: 'No HTTP client available for node'
            };
        }

        return {
            nodeId: targetNode.nodeId,
            nodeName: targetNode.hostname,
            apiUrl: client.defaults.baseURL || '',
            success: true
        };
    }

    /**
     * Handle node going offline - mark offline and trigger failover
     */
    async handleNodeOffline(nodeId: string): Promise<void> {
        const node = this.nodesCache.get(nodeId);

        if (!node) {
            return;
        }

        node.status = 'offline';
        this.nodeClients.delete(nodeId);

        await this.fastify.knex('nodes')
            .where('id', parseInt(nodeId, 10))
            .update({ status: 'offline' });

        logger.warn(`[NodeManager] Node ${node.hostname} marked as offline`);

        this.fastify.io?.emit('node:offline', {
            nodeId,
            nodeName: node.hostname
        });

        await this.failoverPrintersFromNode(nodeId);
    }

    /**
     * Failover printers from offline node to available online nodes
     */
    private async failoverPrintersFromNode(nodeId: string): Promise<void> {
        const node = this.nodesCache.get(nodeId);

        if (!node) return;

        for (const printer of node.printers) {
            const backupNode = await this.findBackupNodeForPrinter(printer.name, printer.id, nodeId);

            if (backupNode) {
                await this.fastify.knex('printers')
                    .where('id', printer.id)
                    .update({ node_id: parseInt(backupNode.nodeId, 10) });

                this.fastify.io?.emit('printer:failover', {
                    printerId: printer.id,
                    printerName: printer.name,
                    fromNode: nodeId,
                    toNode: backupNode.nodeId,
                    toNodeName: backupNode.hostname
                });

                logger.info(`[NodeManager] Printer ${printer.name} failed over from ${node.hostname} to ${backupNode.hostname}`);
            }
        }
    }

    /**
     * Find backup node for printer when primary is offline
     */
    private async findBackupNodeForPrinter(printerName: string, printerId: number, excludeNodeId: string): Promise<NodeInfo | null> {
        for (const [, nodeInfo] of this.nodesCache) {
            if (nodeInfo.nodeId === excludeNodeId) continue;
            if (nodeInfo.status !== 'online') continue;

            const hasPrinter = nodeInfo.printers.some(
                p => p.name.toLowerCase() === printerName.toLowerCase()
            );

            if (hasPrinter) {
                return nodeInfo;
            }
        }

        const backupPrinter = await this.fastify.knex('printers')
            .where('name', printerName)
            .where('id', '!=', printerId)
            .where('status', '!=', 'inactive')
            .first();

        if (!backupPrinter || !backupPrinter.node_id) {
            return null;
        }

        const backupNode = await this.fastify.knex('nodes')
            .where('id', backupPrinter.node_id)
            .where('status', 'online')
            .first();

        if (!backupNode) {
            return null;
        }

        return this.nodesCache.get(backupNode.id.toString()) || null;
    }

    /**
     * Get all online nodes
     */
    async getOnlineNodes(): Promise<NodeInfo[]> {
        const onlineNodes: NodeInfo[] = [];

        for (const [, nodeInfo] of this.nodesCache) {
            if (nodeInfo.status === 'online') {
                onlineNodes.push(nodeInfo);
            }
        }

        return onlineNodes;
    }

    /**
     * Get all registered nodes
     */
    async getAllNodes(): Promise<NodeInfo[]> {
        return Array.from(this.nodesCache.values());
    }

    /**
     * Get node by ID
     */
    getNode(nodeId: string): NodeInfo | undefined {
        return this.nodesCache.get(nodeId);
    }

    /**
     * Refresh node cache from database
     */
    async refreshCache(): Promise<void> {
        await this.loadNodesFromDatabase();
    }

    /**
     * Stop the node manager and cleanup
     */
    shutdown(): void {
        if (this.dbSyncInterval) {
            clearInterval(this.dbSyncInterval);
            this.dbSyncInterval = null;
        }

        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
        }

        logger.info('[NodeManager] Shutdown complete');
    }
}

export default NodeManager;