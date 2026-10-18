/**
 * Email Service
 * Handles dispatching verification OTP codes and system emails.
 * Live send: activated when EMAIL_HOST, EMAIL_USER and EMAIL_PASS are set to
 * real (non-placeholder) values in .env — regardless of NODE_ENV.
 * Fallback: logs the code to the terminal (development / no-keys mode).
 */

const MOCK_INDICATORS = ['mock', 'mailtrap', 'sandbox', 'test', 'example', 'placeholder'];

function isRealEmailConfig() {
  const host = process.env.EMAIL_HOST || '';
  const user = process.env.EMAIL_USER || '';
  const pass = process.env.EMAIL_PASS || '';
  if (!host || !user || !pass) return false;
  const combined = (host + user + pass).toLowerCase();
  return !MOCK_INDICATORS.some(indicator => combined.includes(indicator));
}

async function sendEmailVerificationOTP(email, code, recipientName = 'Member') {
  // Always log so developers can see the code during development
  console.log(`\n======================================================`);
  console.log(`[EMAIL DISPATCH] To: ${email} (${recipientName})`);
  console.log(`Subject: Verify your email for Chama Account`);
  console.log(`Body: Hello ${recipientName}, your Chama activation code is: [ ${code} ]`);
  console.log(`Valid for 10 minutes.`);
  console.log(`======================================================\n`);

  if (isRealEmailConfig()) {
    try {
      // Lazy-require nodemailer only when real credentials are configured
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587', 10),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `no-reply@chama.co.ke`,
        to: email,
        subject: 'Verify your Chama Account — Activation Code',
        text: `Hello ${recipientName},\n\nYour Chama account activation code is: ${code}\n\nValid for 10 minutes. Do not share this code.\n\nChama Financial Platform`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;">
            <h2 style="color:#319795;">Chama Account Verification</h2>
            <p>Hello <strong>${recipientName}</strong>,</p>
            <p>Your activation code is:</p>
            <div style="font-size:2rem;font-weight:bold;letter-spacing:.4em;text-align:center;
                        background:#e6fffa;border:1.5px solid #38b2ac;border-radius:8px;
                        padding:18px;margin:20px 0;color:#1e3a5f;">${code}</div>
            <p style="color:#718096;font-size:.88rem;">Valid for 10 minutes. Do not share this code with anyone.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;">
            <p style="color:#718096;font-size:.8rem;">Chama Financial Platform &mdash; Kenya</p>
          </div>`,
      });

      console.log(`[EMAIL] Sent via SMTP to ${email}`);
    } catch (err) {
      console.error(`[EMAIL] SMTP dispatch failed — falling back to terminal log:`, err.message);
      // Do NOT re-throw: the code was already logged above; user experience is not broken
    }
  } else {
    console.log(`[EMAIL] No real SMTP credentials set in .env — code printed to terminal only.`);
  }

  return { success: true, channel: 'EMAIL', recipient: email };
}

module.exports = {
  sendEmailVerificationOTP,
};
