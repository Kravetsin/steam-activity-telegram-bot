import mongoose from 'mongoose';

const linkedUserSchema = new mongoose.Schema(
  {
    telegramUserId: { type: Number, required: true, index: true },
    chatId: { type: Number, required: true, index: true },
    steamId64: { type: String, required: true },
    lastTag: { type: String, default: null },
  },
  {
    _id: true,
  }
);

linkedUserSchema.index({ telegramUserId: 1, chatId: 1 }, { unique: true });

export default mongoose.model('LinkedUser', linkedUserSchema);
