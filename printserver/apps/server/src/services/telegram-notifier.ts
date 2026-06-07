// ────────────────────────────────────────────────────────────────────────────
// TIER-1 #2: Telegram notifier for print job lifecycle events.
//
// Best-effort module. If TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set in
// env, every function is a no-op. Never throws — caller can fire-and-forget.
// ────────────────────────────────────────────────────────────────────────────

import { logger } from '../utils/logger.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

interface SendOpts {
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    silent?: boolean;
}

/**
 * Send a text message to the configured Telegram chat. Returns true on
 * success, false on any failure (or when not configured).
 */
export async function sendTelegram(text: string, opts: SendOpts = {}): Promise<boolean> {
    if (!BOT_TOKEN || !CHAT_ID) {
        return false;
    }
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text,
                parse_mode: opts.parseMode || 'Markdown',
                disable_notification: opts.silent || false,
                disable_web_page_preview: true
            })
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            logger.warn(`[Telegram] send failed: ${resp.status} ${body.slice(0, 120)}`);
            return false;
        }
        return true;
    } catch (err) {
        logger.warn(`[Telegram] send threw: ${(err as Error)?.message}`);
        return false;
    }
}

// ── Domain-specific helpers ────────────────────────────────────────────────

/**
 * Job has been re-queued after a failure. Called between attempts 1 and max-1.
 * Always sent silent so it doesn't spam the chat.
 */
export async function notifyJobRetrying(opts: {
    jobId: string;
    jobName?: string;
    printerName: string;
    attempt: number;
    maxAttempts: number;
    nextRetryIn: number;
    error: string;
}) {
    return sendTelegram(
        `🔄 *Job Retry*\n` +
        `• Job: \`${opts.jobName || opts.jobId.slice(0, 8)}\`\n` +
        `• Printer: *${opts.printerName}*\n` +
        `• Attempt: *${opts.attempt}/${opts.maxAttempts}* — retrying in ${Math.round(opts.nextRetryIn / 1000)}s\n` +
        `• Error: ${opts.error.slice(0, 120)}`,
        { silent: true }
    );
}

/**
 * Job has failed all retry attempts (TIER-1 #2 main ask). Sent with sound
 * so admin sees it.
 */
export async function notifyJobFailedFinal(opts: {
    jobId: string;
    jobName?: string;
    printerName: string;
    attempts: number;
    error: string;
    nodeHostname?: string | null;
    nodeIp?: string | null;
}) {
    const nodeInfo = opts.nodeHostname
        ? `• Node: \`${opts.nodeHostname}\` (\`${opts.nodeIp || '—'}\`)\n`
        : '';
    return sendTelegram(
        `❌ *Job Failed (exhausted retries)*\n` +
        `• Job: \`${opts.jobName || opts.jobId.slice(0, 8)}\`\n` +
        `• Printer: *${opts.printerName}*\n` +
        `• Attempts: *${opts.attempts}*\n` +
        nodeInfo +
        `• Error: ${opts.error.slice(0, 200)}`
    );
}

/**
 * Notify on stuck-job auto-cleanup (TIER-1 #1 side-effect). Sent silent.
 */
export async function notifyJobAutoCancelled(opts: {
    jobId: string;
    jobName?: string;
    reason: 'stuck-processing' | 'stuck-queued';
    stuckMinutes: number;
    printerName?: string;
}) {
    const reasonLabel = opts.reason === 'stuck-processing' ? 'Stuck in processing' : 'Stuck in queue';
    return sendTelegram(
        `🧹 *Job Auto-Cancelled*\n` +
        `• Job: \`${opts.jobName || opts.jobId.slice(0, 8)}\`\n` +
        (opts.printerName ? `• Printer: *${opts.printerName}*\n` : '') +
        `• Reason: ${reasonLabel} for ${opts.stuckMinutes} min`,
        { silent: true }
    );
}
