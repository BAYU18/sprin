/**
 * PrintServer - Printer slug utilities
 * Auto-generates URL-safe slugs for IPP routing.
 * "EPSON LX-310 ESC/P (Copy 1)" → "epson-lx-310-esc-p-copy-1"
 */

/**
 * Generate URL-safe slug from printer name.
 * Lowercase, alphanumeric + hyphens only, max 200 chars.
 * Returns 'printer' as fallback for empty/invalid input.
 */
export function generatePrinterSlug(name: string | null | undefined): string {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 200) || 'printer';
}

/**
 * Generate a unique slug for a printer by checking the database.
 * If `baseSlug` is already taken, appends `-2`, `-3`, etc. until unique.
 *
 * @param knex       - Knex instance
 * @param baseSlug   - Initial slug (typically from generatePrinterSlug)
 * @param excludeId  - Optional printer id to exclude from uniqueness check (for updates)
 * @returns Unique slug string
 */
export async function ensureUniquePrinterSlug(
    knex: any,
    baseSlug: string,
    excludeId?: number
): Promise<string> {
    let finalSlug = baseSlug;
    let suffix = 1;
    const maxAttempts = 1000;  // safety cap

    while (suffix < maxAttempts) {
        const existing = await knex('printers')
            .where({ slug: finalSlug })
            .modify((qb: any) => {
                if (excludeId !== undefined) {
                    qb.whereNot('id', excludeId);
                }
            })
            .first();

        if (!existing) {
            return finalSlug;
        }

        suffix++;
        finalSlug = `${baseSlug}-${suffix}`;
    }

    // Fallback: append timestamp to base slug
    return `${baseSlug}-${Date.now()}`;
}

/**
 * Auto-generate and assign a slug to a printer.
 * Use this as a one-shot helper: generate → check unique → return final slug.
 * Does NOT write to DB; caller must include `slug` in their insert/update.
 */
export async function generateUniquePrinterSlug(
    knex: any,
    printerName: string,
    excludeId?: number
): Promise<string> {
    return ensureUniquePrinterSlug(knex, generatePrinterSlug(printerName), excludeId);
}
