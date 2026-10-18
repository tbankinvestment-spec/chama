const mongoose = require('mongoose');

// Disable buffering so queries fail immediately instead of hanging when Mongo is disconnected
mongoose.set('bufferCommands', false);

let isConnecting = false;
let reconnectTimer = null;

// Map low-level driver errors to an actionable hint for the developer.
function explainMongoError(error) {
  const msg = String((error && error.message) || error);
  if (/IP that isn't whitelisted|whitelist|not allowed to access/i.test(msg)) {
    return "Your current IP is not allowed. Add it in Atlas → Network Access (use 0.0.0.0/0 for local development).";
  }
  if (/bad auth|Authentication failed/i.test(msg)) {
    return 'Wrong database username/password. Check the credentials in MONGODB_URI against Atlas → Database Access.';
  }
  if (/tlsv1 alert|SSL alert|ssl3_read_bytes|self.signed|certificate/i.test(msg)) {
    return 'The TLS handshake to Atlas failed. This is usually caused by antivirus/VPN/firewall doing TLS inspection on port 27017 — disable it or allow outbound TCP 27017.';
  }
  if (/ENOTFOUND|EAI_AGAIN|querySrv|getaddrinfo/i.test(msg)) {
    return 'DNS lookup for the Atlas host failed. Check your internet connection / DNS and try another network.';
  }
  if (/Server selection timed out|serverSelectionTimeout|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return 'Could not reach Atlas in time. The cluster may be paused, or a firewall is blocking port 27017.';
  }
  return null;
}

const connectDB = async () => {
  if (mongoose.connection.readyState === 1 || isConnecting) {
    return mongoose.connection;
  }

  const connUri = process.env.MONGODB_URI;
  if (!connUri) {
    console.error('[MongoDB] MONGODB_URI is not set. Add it to your .env file. Refusing to fall back to a hardcoded cluster/database.');
    return null;
  }

  isConnecting = true;
  try {
    const conn = await mongoose.connect(connUri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log(`[MongoDB] Connected successfully: ${conn.connection.host} (db: ${conn.connection.name})`);
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection FAILED: ${error.name}: ${error.message}`);
    if (error.reason) {
      console.error(`[MongoDB]   reason: ${error.reason.message || error.reason}`);
    }
    const hint = explainMongoError(error);
    if (hint) {
      console.error(`[MongoDB]   → ${hint}`);
    }
    console.warn('[MongoDB] The server will keep running and retry every 5s. Until then, database writes will fail.');
    scheduleReconnect();
    return null;
  } finally {
    isConnecting = false;
  }
};

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(() => {
      if (mongoose.connection.readyState === 0) {
        console.log('[MongoDB] Attempting to reconnect...');
        connectDB();
      }
    }, 5000);
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Connection lost. Attempting to reconnect...');
  scheduleReconnect();
});

mongoose.connection.on('error', (err) => {
  console.error(`[MongoDB] Connection event error: ${err.message}`);
});

module.exports = connectDB;
module.exports.connectDB = connectDB;
