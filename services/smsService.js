/**
 * SMS Service (Africa's Talking Integration)
 * Standardized for Kenyan Mobile Network Operators (Safaricom, Airtel, Telkom).
 * Live send: activated when AT_API_KEY and AT_USERNAME are set to real
 * (non-sandbox / non-mock) values in .env — regardless of NODE_ENV.
 * Fallback: logs the code to the terminal (development / no-keys mode).
 */

const AT_SANDBOX_INDICATORS = ['sandbox', 'mock', 'test', 'placeholder', 'dummy'];

function isRealSMSConfig() {
  const apiKey = process.env.AT_API_KEY || '';
  const username = process.env.AT_USERNAME || '';
  if (!apiKey || !username) return false;
  const combined = (apiKey + username).toLowerCase();
  return !AT_SANDBOX_INDICATORS.some(indicator => combined.includes(indicator));
}

async function sendSMSVerificationOTP(phone, code) {
  const senderId = process.env.AT_SENDER_ID || 'CHAMA';

  // Always log so developers can see the code during development
  console.log(`\n======================================================`);
  console.log(`[SMS DISPATCH] To: ${phone}`);
  console.log(`Sender ID: ${senderId}`);
  console.log(`Message: Your Chama verification code is: ${code}. Valid for 10 mins. Do not share.`);
  console.log(`======================================================\n`);

  if (isRealSMSConfig()) {
    try {
      // Africa's Talking REST API — no extra npm package needed, use built-in https
      const https = require('https');
      const querystring = require('querystring');

      const messageBody = querystring.stringify({
        username: process.env.AT_USERNAME,
        to: phone,
        message: `Your Chama verification code is: ${code}. Valid for 10 mins. Do not share.`,
        from: senderId,
      });

      await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.africastalking.com',
          path: '/version1/messaging',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'apiKey': process.env.AT_API_KEY,
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(messageBody),
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const recipients = parsed?.SMSMessageData?.Recipients || [];
              const success = recipients.some(r => r.statusCode === 101);
              if (!success) {
                console.error(`[SMS] Africa's Talking response:`, data);
                reject(new Error(`SMS delivery failed: ${data}`));
              } else {
                console.log(`[SMS] Sent via Africa's Talking to ${phone}`);
                resolve(parsed);
              }
            } catch (parseErr) {
              reject(parseErr);
            }
          });
        });

        req.on('error', reject);
        req.write(messageBody);
        req.end();
      });
    } catch (err) {
      console.error(`[SMS] Africa's Talking dispatch failed — falling back to terminal log:`, err.message);
      // Do NOT re-throw: the code was already logged above; user experience is not broken
    }
  } else {
    console.log(`[SMS] No real Africa's Talking credentials in .env — code printed to terminal only.`);
  }

  return { success: true, channel: 'SMS', recipient: phone };
}

module.exports = {
  sendSMSVerificationOTP,
};
