// services/sms.js
// Third-party SMS service wrapper (Twilio / Africa's Talking / etc).
//
// Public contract (controllers import these functions only):
//   await smsService.sendVerificationCode(toPhoneE164, code, { req })
//
// Design (same pattern as services/email.js):
//   - Controllers NEVER import Twilio SDK directly.
//   - Provider selection is driven by `SMS_PROVIDER` env var.
//   - Phase 1 = "stub": logs to server console AND surfaces a green flash
//     message on the verify page with the demo code (so registration flow
//     works on a dev machine without paid SMS accounts).
//   - Phase 2 = Twilio: set SMS_PROVIDER=twilio, fill TWILIO_ACCOUNT_SID /
//     TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER in .env.
//   - Phase 3 = Africa's Talking (recommended for KE): SMS_PROVIDER=at,
//     fill AFRICAS_TALKING_USERNAME / AFRICAS_TALKING_API_KEY /
//     AFRICAS_TALKING_SENDER_ID.

function generateVerifyNumber() {
  // Dummy data for dev/demo — use "1234" as fixed verification key number
  // In production, replace with: String(Math.floor(100000 + Math.random() * 900000))
  return "1234";
}

function formatVerificationSms(verifyNumber) {
  return (
    "Chama verification number: " +
    verifyNumber +
    ". Valid for 10 minutes. Do not share this number with anyone."
  );
}

async function stubSend({ to, body }, { req } = {}) {
  const match = body.match(/\b\d{4,6}\b/);
  console.log(
    "\n" +
      "================ [sms] DEMO MODE (no real SMS sent) ================\n" +
      "  To:   " + to + "\n" +
      "  Body: " + body + "\n" +
      "====================================================================\n"
  );
  if (req && typeof req.flash === "function") {
    try {
      req.flash("messages", {
        phoneDemo:
          "📱 Demo mode: SMS verification number is <strong>" +
          (match ? match[0] : "") +
          "</strong> (in production, this would be sent to " + to + ")",
      });
    } catch (_) {
      /* ignore flash errors */
    }
  }
  return { provider: "stub", ok: true };
}

async function twilioSend({ to, body }) {
  const client = require("twilio")(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const msg = await client.messages.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    body,
  });
  return { provider: "twilio", ok: true, sid: msg.sid };
}

function getProvider() {
  return (process.env.SMS_PROVIDER || "stub").toLowerCase();
}

async function sendSms({ to, body }, context = {}) {
  if (!to) throw new Error("sendSms: `to` phone number (E.164) is required");
  if (!body) throw new Error("sendSms: `body` text is required");

  const provider = getProvider();
  switch (provider) {
    case "stub":
    default:
      return stubSend({ to, body }, context);
    case "twilio":
      return twilioSend({ to, body }, context);
    // case "at":  return africasTalkingSend({ to, body });   // Phase 3
  }
}

async function sendVerificationNumber(toPhone, verifyNumber, context = {}) {
  const number = verifyNumber || generateVerifyNumber();
  if (!/^\d{4,6}$/.test(String(number))) {
    throw new Error("sendVerificationNumber: number must be 4–6 digits");
  }
  const body = formatVerificationSms(String(number));
  const res = await sendSms({ to: toPhone, body }, context);
  return { ...res, verifyNumber: String(number) };
}

async function sendVerificationCode(toPhone, code, context = {}) {
  return sendVerificationNumber(toPhone, code, context);
}

module.exports = {
  sendSms,
  generateVerifyNumber,
  sendVerificationNumber,
  sendVerificationCode,
  _internal: {
    formatVerificationSms,
    stubSend,
    getProvider,
  },
};
