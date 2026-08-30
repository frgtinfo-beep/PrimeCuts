const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: { type: String, required: true },
  service: { type: String, required: true },
  addons: { type: [String], default: [] },
  date: { type: String, required: true },
  time: { type: String, required: true },
  totalPrice: { type: Number, required: true },
  paymentProvider: { type: String, default: "sumup" },
  sumupCheckoutId: { type: String },
  sumupCheckoutReference: { type: String },
  status: { type: String, enum: ["pending", "confirmed"], default: "pending" },
  expiresAt: { type: Date, default: Date.now, expires: 600 },

  // Reporting this completed transaction to Branch.nu for their revenue-share fee tracking.
  // Snapshot the SumUp transaction (not the checkout) once, so retries don't need to hit SumUp again.
  branchTransactionId: { type: String },
  branchTransactionAmount: { type: Number },
  branchTransactionTimestamp: { type: Date },
  branchReportStatus: { type: String, enum: ["pending", "sent", "failed"] },
  branchReportAttempts: { type: Number, default: 0 },
  branchReportNextAttemptAt: { type: Date },
  branchReportLastError: { type: String },
});

module.exports = mongoose.model("Appointment", appointmentSchema);
