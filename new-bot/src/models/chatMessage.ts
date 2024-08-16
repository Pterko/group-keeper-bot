import mongoose from "mongoose";
import { Message } from "@grammyjs/types";

const chatMessageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Number,
  },
  chatId: {
    type: mongoose.Schema.Types.Number,
  },
  message: {
    type: mongoose.Schema.Types.Mixed,
  }
}, { timestamps: true, collection: "chatMessages" });

export const chatMessageModel = mongoose.model("chatMessages", chatMessageSchema);