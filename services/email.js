// services/email.js
// Third-party email service wrapper.
//
// Goal: controllers (verifyController) should ONLY ever call
//   await emailService.sendVerificationCode(toEmail, code)
// They should NOT know which provider is used, nor import any SDK directly.
//
// Implementation phases:
//   Phase 1 (CURRENT) — Stub "console + session flash" mode. In demo/dev,
//     logs the code to the server console AND attaches a green flash message
//     to the response so the verify page shows the code as a convenience.
//     No real email is sent. No SMTP connection attempts.
//   Phase 2 — Google OAuth2-authed Nodemailer against Gmail SMTP.
//     Set `EMAIL_PROVIDER=gmail` in .env and fill GOOGLE_CLIENT_ID /
//     GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GMAIL_FROM.
//   Phase 3 — Alternative transactional providers (Resend, Postmark,
//     SendGrid). Add a `switch (provider)` branch and inject keys via env.
//
// The exported API (sendVerificationCode / sendEmail) stays the same across
// all phases so controllers never need to be touched.

function formatVerificationEmail(code) {
  return {
    subject: "Your Chama verification code",
    text:
      "Welcome to your Chama group.\n\n" +
      "Enter this 6-digit code to complete registration:\n\n" +
      "          " + code + "\n\n" +
      "The code is valid for 10 minutes. If you did not request this, " +
      "please ignore this email.\n\n— The Chama Team",
    html:
      '<div style="font-family:system-ui,sans-serif;line-height:1.6;color:#1a202c;">' +
      '<h2 style="color:#2b6cb0;">Welcome to your Chama group</h2>' +
      "<p>Enter this 6-digit code to complete registration:</p>" +
      '<div style="margin:24px 0;padding:16px 24px;background:#edf2f7;' +
      'border-radius:8px;font-size:28px;letter-spacing:8px;text-align:center;' +
      'font-weight:700;color:#2b6cb0;">' +
      code +
      "</div>" +
      '<p style="color:#718096;font-size:14px;">Valid for 10 minutes. ' +
      "If you did not request this, ignore this email.</p>" +
      "</div>",
  };
}

async function stubSend({ to, subject, text, _html }, { req } = {}) {
  console.log(
    "\n" +
      "=============== [email] DEMO MODE (no real email sent) ===============\n" +
      "  To:       " + to + "\n" +
      "  Subject:  " + subject + "\n" +
      "  ---------------- body ----------------\n" +
      text.split("\n").map((l) => "  " + l).join("\n") + "\n" +
      "======================================================================\n"
  );
  if (req && typeof req.flash === "function") {
    try {
      req.flash("messages", {
        emailDemo:
          "📧 Demo mode: email verification code is <strong>" +
          (text.match(/\b\d{4,6}\b/) || [])[0] +
          "</strong> (in production, this would be emailed to " + to + ")",
      });
    } catch (_) {
      /* ignore flash errors */
    }
  }
  return { provider: "stub", ok: true };
}

function getProvider() {
  return (process.env.EMAIL_PROVIDER || "stub").toLowerCase();
}

async function sendEmail({ to, subject, text, html }, context = {}) {
  if (!to) throw new Error("sendEmail: `to` recipient is required");
  if (!subject) throw new Error("sendEmail: `subject` is required");
  if (!text && !html) throw new Error("sendEmail: either `text` or `html` body is required");

  const provider = getProvider();
  switch (provider) {
    case "stub":
    default:
      return stubSend({ to, subject, text, html }, context);
    // case "gmail":    return sendViaGmailNodemailer(...);  // Phase 2
    // case "resend":   return sendViaResend(...);           // Phase 3
  }
}

async function sendVerificationCode(toEmail, code, context = {}) {
  if (!/^\d{4,6}$/.test(String(code))) {
    throw new Error("sendVerificationCode: code must be 4–6 digits");
  }
  const { subject, text, html } = formatVerificationEmail(String(code));
  return sendEmail({ to: toEmail, subject, text, html }, context);
}

module.exports = {
  sendEmail,
  sendVerificationCode,
  _internal: {
    formatVerificationEmail,
    stubSend,
    getProvider,
  },
};
