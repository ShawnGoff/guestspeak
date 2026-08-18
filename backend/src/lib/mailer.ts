import nodemailer from 'nodemailer';

/**
 * Sends an email.
 * In development (no SMTP env vars set), logs the email to the console instead.
 * In production, set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 */

/** True when real mail can actually be sent. */
export const mailConfigured = !!process.env.SMTP_HOST;

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
  const msg = 'SMTP is not configured — password resets and session-live emails '
    + 'are silently discarded. Set SMTP_HOST/PORT/USER/PASS/FROM.';
  if (IS_PROD) console.error(`[mailer] ${msg}`);
  else console.warn(`[mailer] ${msg} (expected in development)`);
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
  });
}

const FROM = process.env.SMTP_FROM ?? 'GuestSpeak <noreply@guestspeak.app>';

export async function sendSessionLive(
  to: string,
  opts: { orgName: string; sessionTitle: string; sessionUrl: string },
) {
  const { orgName, sessionTitle, sessionUrl } = opts;
  const transport = createTransport();

  const msg = {
    from: FROM,
    to,
    subject: `🎙 ${orgName} is live: ${sessionTitle}`,
    text: `${orgName} just started a live Q&A session.\n\n${sessionTitle}\n\nJoin here: ${sessionUrl}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#F5921E;">GuestSpeak</h2>
        <p style="color:#888;font-size:13px;">A channel you follow just went live.</p>
        <h3 style="margin:0 0 4px;">${orgName}</h3>
        <p style="font-size:17px;font-weight:bold;margin:0 0 20px;">${sessionTitle}</p>
        <a href="${sessionUrl}"
           style="display:inline-block;background:#F5921E;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
          Join session →
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:24px;">
          You received this because you follow ${orgName} on GuestSpeak.
        </p>
      </div>
    `,
  };

  const info = await transport.sendMail(msg);

  if (!process.env.SMTP_HOST) {
    console.log('\n📧 [DEV] Session live email (not actually sent):');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${msg.subject}`);
    console.log(`   Session URL: ${sessionUrl}\n`);
  }

  return info;
}

export async function sendPasswordReset(to: string, resetUrl: string) {
  const transport = createTransport();

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

  const info = await transport.sendMail(msg);

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
