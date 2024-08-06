import mongoose from "mongoose";
import { config } from "#root/config.js";
import { logger } from "#root/logger.js";

export async function connectToDatabase() {
  try {
    await mongoose.connect(config.MONGODB_URI, {
      //useNewUrlParser: true,
      //useUnifiedTopology: true,
    });
    logger.info("Connected to MongoDB");
  } catch (error) {
    logger.error("Error connecting to MongoDB", error);
    process.exit(1);
  }
}