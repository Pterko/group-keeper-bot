import mongoose from "mongoose";
import { config } from "#root/config.js";
import { logger } from "#root/logger.js";

export async function connectToDatabase() {
  try {
    console.log(`Connecting to MongoDB`);
    const connection = await mongoose.connect(config.MONGODB_URI, {
      //useNewUrlParser: true,
      //useUnifiedTopology: true,
    });

    logger.info(`Connected to MongoDB. Version: ${connection.version}`);
  } catch (error) {
    logger.error("Error connecting to MongoDB", error);
    logger.error(error);
    process.exit(1);
  }
}