/**
 * Paper size service — single source of truth for all paper size logic.
 *
 * Resolution order (per printer):
 *   1. printers.config.paper (per-printer override)
 *   2. settings.default_paper_size (server-wide default, A4)
 *   3. hardcoded 'A4' (last-resort fallback)
 *
 * Custom paper sizes are user-defined names stored in settings
 *   custom_paper_sizes = JSON array of { id, name, widthMm, heightMm }
 * and merged with the built-in list when reporting supported media.
 */

import { logger } from '../utils/logger.js';

export interface PaperSize {
    name: string;          // 'A4', 'Letter', 'Custom.MyForm'
    widthMm: number;
    heightMm: number;
    builtin: boolean;      // true for ISO/JIS/US standards, false for user-defined
}

export interface PaperConfig {
    size: string;          // paper name to use
    orientation?: 'portrait' | 'landscape';
    tray?: string;         // 'auto' | 'tray-1' | 'manual' | etc.
    customWidthMm?: number;  // only when size starts with 'Custom.'
    customHeightMm?: number; // only when size starts with 'Custom.'
}

// Built-in paper sizes (ISO + US + Asian standards commonly used in Indonesia)
// All dimensions in millimetres.
export const BUILTIN_PAPER_SIZES: PaperSize[] = [
    { name: 'A3',      widthMm: 297,  heightMm: 420,  builtin: true },
    { name: 'A4',      widthMm: 210,  heightMm: 297,  builtin: true },
    { name: 'A5',      widthMm: 148,  heightMm: 210,  builtin: true },
    { name: 'A6',      widthMm: 105,  heightMm: 148,  builtin: true },
    { name: 'B4',      widthMm: 257,  heightMm: 364,  builtin: true },
    { name: 'B5',      widthMm: 182,  heightMm: 257,  builtin: true },
    { name: 'Letter',  widthMm: 215.9, heightMm: 279.4, builtin: true },
    { name: 'Legal',   widthMm: 215.9, heightMm: 355.6, builtin: true },
    { name: 'Tabloid', widthMm: 279.4, heightMm: 431.8, builtin: true },
    { name: 'Executive', widthMm: 184.15, heightMm: 266.7, builtin: true },
    { name: 'Folio',   widthMm: 210,  heightMm: 330,  builtin: true },  // F4 Indonesia
    { name: 'F4',      widthMm: 215.9, heightMm: 330.2, builtin: true }, // F4/Folusio
    { name: 'Statement', widthMm: 139.7, heightMm: 215.9, builtin: true },
];

const DEFAULT_PAPER_NAME = 'A4';
const CUSTOMS_KEY = 'custom_paper_sizes';
const DEFAULT_KEY = 'default_paper_size';

function parseCustomList(raw: string | null | undefined): PaperSize[] {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((x) => x && typeof x.name === 'string'
                && typeof x.widthMm === 'number' && typeof x.heightMm === 'number')
            .map((x) => ({
                name: x.name,
                widthMm: x.widthMm,
                heightMm: x.heightMm,
                builtin: false,
            }));
    } catch (e) {
        logger.warn(`[PaperService] Failed to parse custom_paper_sizes: ${(e as Error).message}`);
        return [];
    }
}

function serializeCustomList(list: PaperSize[]): string {
    return JSON.stringify(list.map((p) => ({
        name: p.name,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
    })));
}

/**
 * Return the merged list of built-in + custom paper sizes.
 */
export async function listPaperSizes(knex: any): Promise<PaperSize[]> {
    const row = await knex('settings').where({ key: CUSTOMS_KEY }).first();
    const customs = parseCustomList(row?.value);
    return [...BUILTIN_PAPER_SIZES, ...customs];
}

export async function getCustomPaperSizes(knex: any): Promise<PaperSize[]> {
    const row = await knex('settings').where({ key: CUSTOMS_KEY }).first();
    return parseCustomList(row?.value);
}

export async function setCustomPaperSizes(knex: any, list: PaperSize[]): Promise<PaperSize[]> {
    // Filter out anything that overlaps a built-in name to prevent confusion
    const filtered = list.filter(
        (p) => !BUILTIN_PAPER_SIZES.some((b) => b.name.toLowerCase() === p.name.toLowerCase())
    );
    const value = serializeCustomList(filtered);
    const exists = await knex('settings').where({ key: CUSTOMS_KEY }).first();
    if (exists) {
        await knex('settings').where({ key: CUSTOMS_KEY }).update({ value, updated_at: new Date() });
    } else {
        await knex('settings').insert({ key: CUSTOMS_KEY, value, type: 'json',
            description: 'User-defined custom paper sizes (JSON array)' });
    }
    return filtered;
}

export async function getDefaultPaperName(knex: any): Promise<string> {
    const row = await knex('settings').where({ key: DEFAULT_KEY }).first();
    return row?.value || DEFAULT_PAPER_NAME;
}

export async function setDefaultPaperName(knex: any, name: string): Promise<string> {
    const all = await listPaperSizes(knex);
    if (!all.find((p) => p.name === name)) {
        throw new Error(`Unknown paper size: ${name}`);
    }
    const exists = await knex('settings').where({ key: DEFAULT_KEY }).first();
    if (exists) {
        await knex('settings').where({ key: DEFAULT_KEY }).update({ value: name, updated_at: new Date() });
    } else {
        await knex('settings').insert({ key: DEFAULT_KEY, value: name, type: 'string',
            description: 'Server-wide default paper size' });
    }
    return name;
}

/**
 * Resolve the effective paper config for a given printer.
 * Applies the precedence: per-printer > global default > A4.
 */
export async function resolvePaperForPrinter(knex: any, printerId: number): Promise<PaperConfig> {
    const printer = await knex('printers').where({ id: printerId }).first();
    const override = (printer?.config as any)?.paper as PaperConfig | undefined;

    const size = override?.size || (await getDefaultPaperName(knex));
    const all = await listPaperSizes(knex);
    const found = all.find((p) => p.name === size);

    return {
        size,
        orientation: override?.orientation || 'portrait',
        tray: override?.tray || 'auto',
        customWidthMm: override?.customWidthMm ?? found?.widthMm,
        customHeightMm: override?.customHeightMm ?? found?.heightMm,
    };
}

/**
 * Convert millimetres to 1/100 inch units (used by .NET PaperSize.Width/Height).
 * Rounded to nearest integer.
 */
export function mmToHundredthsInch(mm: number): number {
    return Math.round((mm / 25.4) * 100);
}

/**
 * Build the IPP `media-supported` keyword list. Built-in names map to
 * standard IPP keywords; custom sizes are emitted as `Custom.WxHin` or
 * `Custom.WxHmm` per RFC 8011 §5.4.13.
 */
export function buildIppMediaKeywords(sizes: PaperSize[]): string[] {
    const out: string[] = [];
    for (const p of sizes) {
        if (p.builtin) {
            out.push(ippKeywordForBuiltin(p.name));
        } else {
            out.push(`custom_${p.widthMm.toFixed(0)}x${p.heightMm.toFixed(0)}mm`);
        }
    }
    return out;
}

function ippKeywordForBuiltin(name: string): string {
    const map: Record<string, string> = {
        'A3':         'iso_a3_297x420mm',
        'A4':         'iso_a4_210x297mm',
        'A5':         'iso_a5_148x210mm',
        'A6':         'iso_a6_105x148mm',
        'B4':         'jis_b4_257x364mm',
        'B5':         'jis_b5_182x257mm',
        'Letter':     'na_letter_8.5x11in',
        'Legal':      'na_legal_8.5x14in',
        'Tabloid':    'na_tabloid_11x17in',
        'Executive':  'na_executive_7.25x10.5in',
        'Folio':      'na_foolscap_8.5x13in',
        'F4':         'na_foolscap_8.5x13in',
        'Statement':  'na_invoice_5.5x8.5in',
    };
    return map[name] || `custom_${name}`;
}
