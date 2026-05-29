import mongoose from 'mongoose';

const chatPersonaSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  persona: { type: String, required: true },
  setByUserId: { type: Number },
  setByName: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('ChatPersona', chatPersonaSchema);
