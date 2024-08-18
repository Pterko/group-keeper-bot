import mongoose from "mongoose";

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