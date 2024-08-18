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

chatMessageSchema.index({ chatId: 1, createdAt: 1 });

export const chatMessageModel = mongoose.model("chatMessages", chatMessageSchema);