import nodemailer from 'nodemailer';

/**
 * Sends an email.
 * In development (no SMTP env vars set), logs the email to the console instead.
 * In production, set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 */

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST) {
    // Dev mode — use nodemailer's built-in preview (logs to console)
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

  // In dev (jsonTransport), log the reset URL so you can use it without real email
  if (!process.env.SMTP_HOST) {
    console.log('\n📧 [DEV] Password reset email (not actually sent):');
    console.log(`   To: ${to}`);
    console.log(`   Reset URL: ${resetUrl}\n`);
  }

  return info;
}
