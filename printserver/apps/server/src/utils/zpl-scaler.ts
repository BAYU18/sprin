/**
 * ZPL Scale Compensation for RAW TCP print path.
 *
 * When a ZPL printer's Windows driver sends data to the RAW TCP port,
 * the driver may use a larger logical page than the actual label size,
 * causing content to appear zoomed. This module scales key ZPL commands
 * to compensate.
 *
 * Key commands scaled:
 *   ^PW  — Print Width (dots)
 *   ^LL  — Label Length (dots)
 *   ^FO  — Field Origin (X,Y in dots)
 *   ^BY  — Barcode module width
 *   ^LS  — Label Start (X offset)
 *   ^LH  — Label Home (X,Y)
 *   ^LR  — Label Reference
 *   ^LX  — Label X home
 *
 * ZPL spec: commands start with ^ or ~, followed by 2-letter code,
 * then parameters. Parameters are numbers (dots) or alphanumeric.
 */

/**
 * Scale a ZPL buffer by the given factor.
 * Returns a new Buffer with scaled commands; original is untouched.
 *
 * @param zplData  Raw ZPL buffer from the Windows driver
 * @param factor   Scale factor (0.0–1.0), e.g. 0.7 for 70%
 * @returns        New Buffer with scaled ZPL
 */
export function scaleZpl(zplData: Buffer, factor: number): Buffer {
    let text = zplData.toString('ascii');

    // ^PWn — Print Width (integer dots)
    text = text.replace(/\^PW(\d+)/gi, (_match, num) => {
        return `^PW${Math.round(parseInt(num, 10) * factor)}`;
    });

    // ^LLn — Label Length (integer dots)
    text = text.replace(/\^LL(\d+)/gi, (_match, num) => {
        return `^LL${Math.round(parseInt(num, 10) * factor)}`;
    });

    // ^FXX,Y — Field Origin (both X and Y coordinates)
    text = text.replace(/\^FO(\d+),(\d+)/gi, (_match, x, y) => {
        const sx = Math.round(parseInt(x, 10) * factor);
        const sy = Math.round(parseInt(y, 10) * factor);
        return `^FO${sx},${sy}`;
    });

    // ^BYn — Barcode module width (numeric, may be decimal)
    text = text.replace(/\^BY([\d.]+)/gi, (_match, num) => {
        const scaled = parseFloat(num) * factor;
        // Barcode width must be at least 1 dot
        return `^BY${Math.max(1, Math.round(scaled))}`;
    });

    // ^LSn — Label Start (X offset, can be negative)
    text = text.replace(/\^LS(-?\d+)/gi, (_match, num) => {
        return `^LS${Math.round(parseInt(num, 10) * factor)}`;
    });

    // ^LHX,Y — Label Home (X,Y coordinates)
    text = text.replace(/\^LH(-?\d+),(-?\d+)/gi, (_match, x, y) => {
        const sx = Math.round(parseInt(x, 10) * factor);
        const sy = Math.round(parseInt(y, 10) * factor);
        return `^LH${sx},${sy}`;
    });

    // ^LXn — Label X home
    text = text.replace(/\^LX(\d+)/gi, (_match, num) => {
        return `^LX${Math.round(parseInt(num, 10) * factor)}`;
    });

    // ^LRn — Label Reference
    text = text.replace(/\^LR(\d+)/gi, (_match, num) => {
        return `^LR${Math.round(parseInt(num, 10) * factor)}`;
    });

    return Buffer.from(text, 'ascii');
}

/**
 * Detect if a buffer contains ZPL commands.
 * Checks for common ZPL start-of-label (^XA) or end (^XZ).
 */
export function isZpl(data: Buffer): boolean {
    const head = data.toString('ascii', 0, Math.min(data.length, 256));
    return /\^XA/i.test(head) || /\^XZ/i.test(head) || /\^FO/i.test(head);
}
