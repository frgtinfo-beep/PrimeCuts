const mongoose = require("mongoose");

// A window an admin has marked themselves unavailable for (e.g. "out from 17:00 until 18:30") —
// separate from actual bookings. Blocks a range of the day rather than a single slot.
const blockedTimeSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    startTime: { type: String, required: true }, // HH:MM
    endTime: { type: String, required: true }, // HH:MM
    reason: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("BlockedTime", blockedTimeSchema);
