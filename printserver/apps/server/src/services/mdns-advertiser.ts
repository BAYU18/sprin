import { Bonjour, Service } from 'bonjour-service';
import { logger } from '../utils/logger.js';

const SERVER_NAME = process.env.SERVER_NAME || 'PrintServer';
const SERVER_IP = process.env.SERVER_IP || '127.0.0.1';
const SERVER_PORT = parseInt(process.env.PORT || '3000', 10);

interface PrinterCapabilities {
    color?: boolean;
    duplex?: boolean;
    scan?: boolean;
    fax?: boolean;
}

interface Publisher {
    id: number;
    name: string;
    slug: string;
    displayName?: string;
    capabilities?: PrinterCapabilities;
}

interface PrinterAdvertisement {
    ipp: Service | null;
    ipps: Service | null;
}

export class MdnsAdvertiser {
    private bonjour: Bonjour | null = null;
    private advertisements: Map<string, PrinterAdvertisement> = new Map();

    constructor() {
        this.bonjour = new Bonjour();
    }

    startAdvertising(publishers: Publisher[]): void {
        if (!this.bonjour) {
            logger.error('[mDNS] Bonjour not initialized');
            return;
        }

        logger.info(`[mDNS] Starting advertising for ${publishers.length} publishers`);

        for (const publisher of publishers) {
            this.advertisePrinter(publisher);
        }

        logger.info('[mDNS] Advertising started');
    }

    stopAdvertising(): void {
        logger.info('[mDNS] Stopping all advertisements');

        for (const [slug, ads] of this.advertisements) {
            try {
                if (ads.ipp) {
                    ads.ipp.stop();
                }
                if (ads.ipps) {
                    ads.ipps.stop();
                }
            } catch (error) {
                logger.warn(`[mDNS] Error stopping advertisement for ${slug}:`, error);
            }
        }

        this.advertisements.clear();

        if (this.bonjour) {
            try {
                this.bonjour.destroy();
            } catch (error) {
                logger.warn('[mDNS] Error destroying bonjour:', error);
            }
            this.bonjour = new Bonjour();
        }

        logger.info('[mDNS] All advertisements stopped');
    }

    updatePrinter(printer: Publisher): void {
        const existing = this.advertisements.get(printer.slug);

        if (existing) {
            this.removePrinter(printer.slug);
        }

        this.advertisePrinter(printer);
        logger.info(`[mDNS] Updated advertisement for printer: ${printer.slug}`);
    }

    removePrinter(printerSlug: string): void {
        const ads = this.advertisements.get(printerSlug);

        if (ads) {
            try {
                if (ads.ipp) {
                    ads.ipp.stop();
                }
                if (ads.ipps) {
                    ads.ipps.stop();
                }
            } catch (error) {
                logger.warn(`[mDNS] Error removing advertisement for ${printerSlug}:`, error);
            }

            this.advertisements.delete(printerSlug);
            logger.info(`[mDNS] Removed advertisement for printer: ${printerSlug}`);
        }
    }

    private advertisePrinter(publisher: Publisher): void {
        if (!this.bonjour) {
            return;
        }

        const displayName = publisher.displayName || publisher.name;
        const capabilities = publisher.capabilities || {};

        const txtRecords = this.buildTxtRecords(publisher.slug, displayName, capabilities);
        const adminUrl = `http://${SERVER_IP}:${SERVER_PORT}`;

        const ippOptions = {
            name: displayName,
            type: '_ipp._tcp',
            port: 631,
            txt: txtRecords,
            host: SERVER_IP,
            published: true,
            proxy: true
        };

        const ippsOptions = {
            name: displayName,
            type: '_ipps._tcp',
            port: 443,
            txt: txtRecords,
            host: SERVER_IP,
            published: true,
            proxy: true
        };

        try {
            const ippService = this.bonjour.publish(ippOptions);
            const ippsService = this.bonjour.publish(ippsOptions);

            this.advertisements.set(publisher.slug, {
                ipp: ippService,
                ipps: ippsService
            });

            logger.debug(`[mDNS] Advertised printer ${publisher.slug} on _ipp._tcp:631 and _ipps._tcp:443`);
        } catch (error) {
            logger.error(`[mDNS] Failed to advertise printer ${publisher.slug}:`, error);
        }
    }

    private buildTxtRecords(
        printerSlug: string,
        displayName: string,
        capabilities: PrinterCapabilities
    ): Record<string, string> {
        return {
            'txtvers': '1',
            'qtotal': '1',
            'rp': `ipp/print/${printerSlug}`,
            'ty': displayName,
            'adminurl': `http://${SERVER_IP}:${SERVER_PORT}`,
            'pdl': 'application/pdf,image/urf,image/pwg-raster',
            'Color': capabilities.color ? 'T' : 'F',
            'Duplex': capabilities.duplex ? 'T' : 'F',
            'Scan': capabilities.scan ? 'T' : 'F',
            'Fax': capabilities.fax ? 'T' : 'F'
        };
    }
}

export default MdnsAdvertiser;