const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    service: { type: String, required: true },
    addons: { type: [String], default: [] },
    date: { type: String, required: true },
    time: { type: String, required: true },
    totalPrice: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'confirmed'], default: 'pending' },
    expiresAt: { type: Date, default: Date.now, expires: 600 }
});

module.exports = mongoose.model('Appointment', appointmentSchema);