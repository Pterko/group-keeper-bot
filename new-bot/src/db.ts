import mongoose from "mongoose";
import { config } from "#root/config.js";
import { logger } from "#root/logger.js";

export async function connectToDatabase() {
  try {
    const connection = await mongoose.connect(config.MONGODB_URI, {
      //useNewUrlParser: true,
      //useUnifiedTopology: true,
    });

    logger.info(`Connected to MongoDB. Version: ${connection.version}`);
  } catch (error) {
    logger.error("Error connecting to MongoDB", error);
    process.exit(1);
  }
}