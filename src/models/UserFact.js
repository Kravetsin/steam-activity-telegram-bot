import mongoose from 'mongoose';

const userFactSchema = new mongoose.Schema({
  chatId: { type: Number, required: true },
  telegramUserId: { type: Number, required: true },
  displayName: { type: String, default: '' },
  facts: { type: [String], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

userFactSchema.index({ chatId: 1, telegramUserId: 1 }, { unique: true });

export default mongoose.model('UserFact', userFactSchema);
