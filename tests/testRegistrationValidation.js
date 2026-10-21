const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
const connectDB = require('../config/db');
require('dotenv').config();
// tests/testRegistrationValidation.js
// Verification test suite for Registration form standard input compliance and anti-collision rules

const assert = require('assert');
const { createApp } = require('../config/app');
const authRoutes = require('../routes/authRoutes');
const apiAuthRoutes = require('../routes/apiAuth');
const { normalizeKenyanPhone } = require('../utils/phoneNormalizer');

const app = createApp();
app.use('/auth', authRoutes);
app.use(apiAuthRoutes);

async function run() {
  await connectDB();
  console.log('--- Testing Registration Form Phone & Email Validation & Anti-Collision ---');
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let failed = 0;
  let ipCounter = 1;

  async function postRegister(payload) {
    const ip = `10.0.1.${ipCounter++}`;
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`[PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`[FAIL] ${name}: ${err.message}`);
        failed++;
      }
    })();
  }

  const validPayload = {
    fullName: 'Jane Mwangi',
    dob: '1995-05-15',
    gender: 'Female',
    phone: '0712345678',
    email: 'jane.mwangi@example.com',
    LocationCounty: 'Nairobi',
    locationSubCuonty: 'Westlands',
    locationvilage: 'Parklands',
    personOneName: 'John Mwangi',
    personOneGender: 'Male',
    personOneRelationship: 'Brother',
    personOnePhone: '0722111222',
    personOneEmail: 'john.mwangi@example.com',
    personTwoName: 'Alice Wambui',
    personTwoGender: 'Female',
    personTwoRelationship: 'Mother',
    personTwoPhone: '0733222333',
    personTwoEmail: 'alice.wambui@example.com',
    password: 'Password123!',
  };

  // Test 1: Phone Normalizer unit test
  await test('Phone Normalizer standardizes 07XX, 01XX, +254, spaces', () => {
    assert.strictEqual(normalizeKenyanPhone('0712345678'), '+254712345678');
    assert.strictEqual(normalizeKenyanPhone('0112345678'), '+254112345678');
    assert.strictEqual(normalizeKenyanPhone('+254 712 345 678'), '+254712345678');
    assert.strictEqual(normalizeKenyanPhone('0712-345-678'), '+254712345678');
    assert.strictEqual(normalizeKenyanPhone('0812345678'), null);
    assert.strictEqual(normalizeKenyanPhone('12345'), null);
  });

  // Test 2: Valid Registration succeeds
  await test('Valid registration with distinct standard phones and emails succeeds', async () => {
    const { status, data } = await postRegister(validPayload);
    assert.strictEqual(status, 201);
    assert.strictEqual(data.success, true);
  });

  // Test 3: Invalid Personal Phone rejected
  await test('Invalid Kenyan personal phone format is rejected', async () => {
    const payload = { ...validPayload, phone: '0812345678' };
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /invalid.*phone/i);
  });

  // Test 4: Invalid Personal Email rejected
  await test('Invalid personal email format is rejected', async () => {
    const payload = { ...validPayload, email: 'not-an-email' };
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /valid email/i);
  });

  // Test 5: Contact 1 phone matches Personal Phone (different representations: 0712345678 vs +254712345678)
  await test('Contact 1 phone cannot match Personal phone (anti-collision across formats)', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.phone = '0712345678';
    payload.personOnePhone = '+254 712 345 678'; // Same number with +254 and spaces
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /cannot match.*phone/i);
  });

  // Test 6: Contact 2 phone matches Personal Phone
  await test('Contact 2 phone cannot match Personal phone', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.phone = '0712345678';
    payload.personTwoPhone = '0712345678';
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /cannot match.*phone/i);
  });

  // Test 7: Contact 1 phone matches Contact 2 phone
  await test('Contact 1 phone cannot match Contact 2 phone', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.personOnePhone = '0722111222';
    payload.personTwoPhone = '+254722111222';
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /(?:different|same) phone/i);
  });

  // Test 8: Contact 1 email matches Personal email (case insensitive / spaces)
  await test('Contact 1 email cannot match Personal email (case & trim check)', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.email = 'jane.mwangi@example.com';
    payload.personOneEmail = '  JANE.MWANGI@EXAMPLE.COM  ';
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /cannot match.*email/i);
  });

  // Test 9: Contact 2 email matches Personal email
  await test('Contact 2 email cannot match Personal email', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.email = 'jane.mwangi@example.com';
    payload.personTwoEmail = 'jane.mwangi@example.com';
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /cannot match.*email/i);
  });

  // Test 10: Contact 1 email matches Contact 2 email
  await test('Contact 1 email cannot match Contact 2 email', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.personOneEmail = 'shared@example.com';
    payload.personTwoEmail = 'Shared@Example.COM';
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /(?:different|same) email/i);
  });

  // Test 11: Contact invalid email format rejected
  await test('Contact invalid email format is rejected', async () => {
    const payload = JSON.parse(JSON.stringify(validPayload));
    payload.personOneEmail = 'invalid-email-format';
    const { status, data } = await postRegister(payload);
    assert.strictEqual(status, 400);
    assert.match(data.message, /invalid.*email/i);
  });

  server.close();
  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
