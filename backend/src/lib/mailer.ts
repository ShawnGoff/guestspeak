import nodemailer from 'nodemailer';

/**
 * Sends an email.
 * In development (no SMTP env vars set), logs the email to the console instead.
 * In production, set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 */

/**
 * Resend's HTTP API, preferred over SMTP when a key is present.
 *
 * SMTP is the reason mail was not arriving at all: Railway could not open a
 * connection to smtp.resend.com on 465 and every send died with ETIMEDOUT on
 * CONN. Outbound SMTP ports are routinely filtered by hosting providers —
 * spam control — and nothing in the application can talk its way past that.
 * The HTTP API is port 443, which no one blocks, and it is the integration
 * Resend documents first; SMTP is their compatibility path.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;

/** True when real mail can actually be sent, by either route. */
export const mailConfigured = !!(RESEND_API_KEY || process.env.SMTP_HOST);

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Warns once, loudly, if production is running without a mail provider.
 *
 * Unconfigured mail does not fail — nodemailer's jsonTransport accepts the
 * message and reports success — so a deploy with no SMTP tells every user their
 * reset link is on its way and sends nothing. The only way that surfaces is if
 * somebody says the button does not work.
 */
let warnedNoMail = false;
function warnIfUnconfigured() {
  if (mailConfigured || warnedNoMail) return;
  warnedNoMail = true;
  const msg = 'No mail provider is configured — password resets and '
    + 'session-live emails are silently discarded. Set RESEND_API_KEY '
    + '(preferred) or SMTP_HOST/PORT/USER/PASS.';
  if (IS_PROD) console.error(`[mailer] ${msg}`);
  else console.warn(`[mailer] ${msg} (expected in development)`);
}

/** What both senders hand to the delivery layer. */
interface Message {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** RFC 8058 unsubscribe headers, on bulk mail only. */
  headers?: Record<string, string>;
}

/**
 * Escape for interpolation into the HTML body.
 *
 * Channel names and session titles are user-controlled and were being dropped
 * into the markup raw, so a name containing a quote or an angle bracket broke
 * the email — and worse in a client that renders what it is given.
 */
function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Delivers one message by whichever route is configured.
 *
 * Resend's HTTP API first, SMTP second, and a no-op third so development
 * without either still runs. Errors are thrown rather than swallowed — the
 * callers decide what a failure means, and forgotPassword logs it.
 */
async function deliver(msg: Message): Promise<unknown> {
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: msg.from, to: [msg.to], subject: msg.subject,
        text: msg.text, html: msg.html,
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Resend puts the useful part in the body — an unverified sending domain
      // or a revoked key both come back as plain 4xx otherwise.
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend API ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json();
  }

  return createTransport().sendMail(msg);
}

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST) {
    warnIfUnconfigured();
    // Accepts and discards. Dev only — see warnIfUnconfigured.
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT ?? '587'),
    secure: parseInt(SMTP_PORT ?? '587') === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Nodemailer's defaults are minutes long. Nothing here is worth waiting
    // that long for — a send that has not connected in ten seconds is not
    // about to, and failing fast turns a hang into a log line.
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     20_000,
  });
}

const FROM = process.env.SMTP_FROM || 'GuestSpeak <noreply@guestspeak.app>';

export async function sendSessionLive(
  to: string,
  opts: {
    orgName: string; sessionTitle: string; sessionUrl: string;
    /** Required. This is bulk mail and must carry a way off the list. */
    unsubscribeUrl: string;
  },
) {
  const { orgName, sessionTitle, sessionUrl, unsubscribeUrl } = opts;
  warnIfUnconfigured();

  const msg: Message = {
    from: FROM,
    to,
    subject: `🎙 ${orgName} is live: ${sessionTitle}`,
    text: `${orgName} just started a live Q&A session.\n\n${sessionTitle}\n\n`
      + `Join here: ${sessionUrl}\n\n`
      + `---\nYou receive this because you follow ${orgName} on GuestSpeak.\n`
      + `Stop these emails: ${unsubscribeUrl}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#F5921E;">GuestSpeak</h2>
        <p style="color:#888;font-size:13px;">A channel you follow just went live.</p>
        <h3 style="margin:0 0 4px;">${esc(orgName)}</h3>
        <p style="font-size:17px;font-weight:bold;margin:0 0 20px;">${esc(sessionTitle)}</p>
        <a href="${esc(sessionUrl)}"
           style="display:inline-block;background:#F5921E;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
          Join session →
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:24px;">
          You receive this because you follow ${esc(orgName)} on GuestSpeak.<br>
          <a href="${esc(unsubscribeUrl)}" style="color:#aaa;">Stop these emails</a>
        </p>
      </div>
    `,
    // RFC 8058. The header is what Gmail and Yahoo look for from a bulk
    // sender, and List-Unsubscribe-Post is what makes their built-in
    // unsubscribe button a single POST rather than a page the person has to
    // work through. Both, or the button does not appear.
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };

  const info = await deliver(msg);

  if (!IS_PROD && !mailConfigured) {
    console.log('\n📧 [DEV] Session live email (not actually sent):');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${msg.subject}`);
    console.log(`   Session URL: ${sessionUrl}\n`);
  }

  return info;
}

export async function sendPasswordReset(to: string, resetUrl: string) {
  warnIfUnconfigured();

  const msg = {
    from: FROM,
    to,
    subject: 'Reset your GuestSpeak password',
    text: `You requested a password reset.\n\nClick this link to set a new password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#F5921E;">GuestSpeak</h2>
        <p>You requested a password reset.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#F5921E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Reset password
          </a>
        </p>
        <p style="color:#888;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };

  const info = await deliver(msg);

  // Print the link so a developer can follow it without a mail provider.
  //
  // Gated on NODE_ENV, not on SMTP_HOST. It used to key off the missing host,
  // which is the same condition in development and in a production deploy that
  // simply has no mail configured — so production printed working reset links
  // into the platform logs, where anyone with log access could use them. The
  // label said [DEV]; the environment was not.
  if (!IS_PROD && !mailConfigured) {
    console.log('\n📧 [DEV] Password reset email (not actually sent):');
    console.log(`   To: ${to}`);
    console.log(`   Reset URL: ${resetUrl}\n`);
  }

  return info;
}
