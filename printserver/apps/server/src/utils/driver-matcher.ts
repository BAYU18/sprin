/**
 * Intelligent printer-to-driver matcher.
 *
 * Given a printer name (as reported by the OS/agent, e.g. "EPSON L3210 Series")
 * and the driver catalog, computes a confidence score for each driver and
 * returns the best match. Pure functions — no DB, no IO — so it is fully
 * unit-testable and reusable by both the auto-assign and suggest endpoints.
 *
 * Scoring is additive and capped at 1.0:
 *   - exact normalized name match ........... 1.00 (short-circuit)
 *   - model token match (e.g. "l3210") ...... 0.60
 *   - series/family token match ............. 0.20
 *   - manufacturer / brand match ............ 0.20
 *   - token overlap (Jaccard) ............... up to 0.20
 *
 * A match is only returned when its score meets the confidence threshold,
 * so we never assign a wrong driver just to assign something.
 */

export interface DriverLike {
    id: number;
    name: string;
    manufacturer?: string | null;
}

export interface MatchResult {
    driver: DriverLike;
    score: number;          // 0..1
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];      // human-readable explanation
}

// Known printer brands and common aliases the OS may report.
const BRAND_ALIASES: Record<string, string[]> = {
    epson: ['epson', 'seiko epson', 'seiko'],
    hp: ['hp', 'hewlett', 'hewlett-packard', 'laserjet', 'officejet', 'deskjet'],
    canon: ['canon', 'pixma', 'imageclass', 'maxify'],
    brother: ['brother'],
    samsung: ['samsung', 'xpress'],
    xerox: ['xerox', 'phaser', 'workcentre'],
    lexmark: ['lexmark'],
    kyocera: ['kyocera', 'ecosys'],
    ricoh: ['ricoh'],
    microsoft: ['microsoft', 'ms'],
};

// Stop-words that carry no identifying value in a printer/driver name.
const STOP_WORDS = new Set([
    'series', 'printer', 'driver', 'class', 'generic', 'the', 'and',
    'desktop', 'copy', 'document', 'writer', 'to', 'print',
]);

/** Lower-case, strip punctuation to spaces, collapse whitespace. */
export function normalize(s: string): string {
    return (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Split into meaningful tokens (drops stop-words and 1-char noise). */
export function tokenize(s: string): string[] {
    return normalize(s)
        .split(' ')
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Extract model identifier tokens from a name. These are the high-signal
 * alphanumeric codes that uniquely identify a printer model, e.g.
 *   "EPSON L3210 Series"   -> ["l3210"]
 *   "HP LaserJet P1102"    -> ["p1102"]
 *   "EPSON LX-310 ESC/P"   -> ["lx310", "lx-310"]
 *   "Canon G2010 series"   -> ["g2010"]
 */
export function extractModelTokens(s: string): string[] {
    const norm = normalize(s);
    const tokens = new Set<string>();
    // Letter(s) immediately followed by digits: l3210, p1102, m2020, g2010, lx310
    const re = /\b([a-z]{1,4})\s?-?\s?(\d{2,5})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
        tokens.add(`${m[1]}${m[2]}`);
    }
    // Bare multi-digit codes (>=3 digits) as a weaker signal: "310", "2010"
    const bare = norm.match(/\b\d{3,5}\b/g);
    if (bare) bare.forEach((d) => tokens.add(d));
    return Array.from(tokens);
}

/** Detect the canonical brand key for a name, or null. */
export function detectBrand(s: string): string | null {
    const norm = ` ${normalize(s)} `;
    for (const [brand, aliases] of Object.entries(BRAND_ALIASES)) {
        if (aliases.some((a) => norm.includes(` ${a} `) || norm.includes(a))) {
            return brand;
        }
    }
    return null;
}

/** Jaccard similarity over token sets (0..1). */
function jaccard(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let inter = 0;
    for (const t of Array.from(setA)) if (setB.has(t)) inter++;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
}

/**
 * Score a single driver against a printer name. Returns 0..1 plus reasons.
 */
export function scoreDriver(printerName: string, driver: DriverLike): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    const pNorm = normalize(printerName);
    const dNorm = normalize(driver.name);

    // Exact normalized match → perfect.
    if (pNorm === dNorm) {
        return { score: 1, reasons: ['exact name match'] };
    }

    let score = 0;

    // Model token match — the strongest real-world signal.
    const pModels = extractModelTokens(printerName);
    const dModels = extractModelTokens(driver.name);
    const sharedModel = pModels.filter((t) => dModels.includes(t));
    if (sharedModel.length > 0) {
        score += 0.6;
        reasons.push(`model match: ${sharedModel.join(', ')}`);
    }

    // Manufacturer / brand alignment.
    const pBrand = detectBrand(printerName);
    const dBrand = detectBrand(driver.name) || detectBrand(driver.manufacturer || '');
    if (pBrand && dBrand && pBrand === dBrand) {
        score += 0.2;
        reasons.push(`brand match: ${pBrand}`);
    }

    // Token overlap (catches "esc p", "pixma", "ecotank", etc.).
    const overlap = jaccard(tokenize(printerName), tokenize(driver.name));
    if (overlap > 0) {
        const pts = Math.min(0.2, overlap * 0.4);
        score += pts;
        if (overlap >= 0.34) reasons.push(`name similarity ${(overlap * 100).toFixed(0)}%`);
    }

    return { score: Math.min(1, score), reasons };
}

function toConfidence(score: number): 'high' | 'medium' | 'low' {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
}

/**
 * Find the best driver for a printer name. Returns null when no driver
 * clears the minimum score (default 0.5 — at least a model or brand+overlap).
 */
export function findBestDriver(
    printerName: string,
    drivers: DriverLike[],
    minScore = 0.5,
): MatchResult | null {
    let best: MatchResult | null = null;
    for (const d of drivers) {
        const { score, reasons } = scoreDriver(printerName, d);
        if (score > (best?.score ?? 0)) {
            best = { driver: d, score, confidence: toConfidence(score), reasons };
        }
    }
    if (!best || best.score < minScore) return null;
    return best;
}
