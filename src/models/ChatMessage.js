import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  chatId: { type: Number, required: true },
  telegramUserId: { type: Number, required: true },
  displayName: { type: String, default: '' },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true },
  ts: { type: Date, default: Date.now },
});

chatMessageSchema.index({ chatId: 1, ts: 1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
