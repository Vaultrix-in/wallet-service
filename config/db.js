const mongoose = require('mongoose');

const SERVICE = 'wallet-service';
const DEFAULT_URI = 'mongodb://wallet-db:27017/wallet_db';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

const connectDB = async (attempt = 1) => {
  const uri = process.env.MONGO_URI || DEFAULT_URI;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`[${SERVICE}] MongoDB connected → ${uri}`);
  } catch (error) {
    console.error(`[${SERVICE}] MongoDB connection failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
    if (attempt < MAX_RETRIES) {
      console.log(`[${SERVICE}] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
      return connectDB(attempt + 1);
    }
    console.error(`[${SERVICE}] Could not connect to MongoDB after ${MAX_RETRIES} attempts. Exiting.`);
    process.exit(1);
  }
};

module.exports = connectDB;
