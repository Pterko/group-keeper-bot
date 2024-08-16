import mongoose from "mongoose";

const toxicSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Number,
  },
  chatId: {
    type: mongoose.Schema.Types.Number,
  },
  toxicCounter: {
    type: mongoose.Schema.Types.Number,
  },
  first_name: {
    type: mongoose.Schema.Types.String,
  },
}, { timestamps: true });

export const toxicModel = mongoose.model("toxics", toxicSchema);