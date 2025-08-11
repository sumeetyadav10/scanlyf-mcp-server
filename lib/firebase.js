const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let db;

function initializeFirebase() {
  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      return admin.app();
    }

    // Build service account from environment variables
    const serviceAccount = {
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
    };

    const credential = admin.credential.cert(serviceAccount);
    admin.initializeApp({ credential });
    db = admin.firestore();
    console.log('Firebase initialized successfully from environment variables');
    return admin.app();
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    console.error('Make sure all FIREBASE_* environment variables are set');
    throw error;
  }
}

// Get Firestore instance
function getDb() {
  if (!db) {
    initializeFirebase();
  }
  return db;
}

// Collections
const collections = {
  users: 'users',
  dailyLogs: 'daily_logs',
  tokens: 'bearer_tokens',
  TOXIN_TRACKING: 'toxin_tracking'
};

module.exports = {
  admin,
  initializeFirebase,
  getDb,
  collections
};