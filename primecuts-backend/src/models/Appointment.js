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
  depositAmount: { type: Number, required: true },
  // Separate checkout/processing fee charged on top of the deposit — never part of totalPrice.
  checkoutFee: { type: Number },
  paymentProvider: { type: String, default: "sumup" },
  sumupCheckoutId: { type: String },
  sumupCheckoutReference: { type: String },
  // "expired" = a checkout was actually created (real money could have moved) but SumUp reported
  // it failed/expired, or it lost a same-slot race to another checkout. This status exists so that
  // outcome is a *record*, never a deletion — see resolveCheckoutStatus. Once a real checkout
  // exists for an appointment, that document must never be removed from the database again,
  // no matter the outcome: a customer's contact info must always be recoverable, even years later,
  // if a payment ever turns out to have gone through when we thought it hadn't.
  status: { type: String, enum: ["pending", "confirmed", "cancelled", "expired"], default: "pending" },
  // Why/when an "expired" appointment was released — for forensics, and so the self-healing sweep
  // (reconcileExpiredCheckouts in server.js) knows which ones are worth re-checking against SumUp.
  // "admin_reschedule" = this was still just a pending (unpaid) hold when an admin's reschedule
  // claimed its slot — deliberately kept separate from "collision" so it never shows up in the
  // urgent "Betaald, Geen Plek" panel, which is specifically for holds whose payment had actually
  // gone through. If a pending hold like this *had* just been paid for, the webhook/redirect
  // confirm flow's own race-detection still catches that independently (see resolveCheckoutStatus)
  // and reports it as a genuine "collision" once it discovers the slot is now taken.
  releasedReason: { type: String, enum: ["failed", "expired", "past_validity", "collision", "admin_reschedule"] },
  releasedAt: { type: Date },
  // Set when this appointment is one occurrence of a recurring membership (see models/Subscription).
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
  // No longer a Mongo TTL field (see the dropped expiresAt_1 index) — a blind time-based delete
  // here previously raced a real payment: it could destroy a "pending" appointment that SumUp had
  // actually just marked PAID, if the webhook/redirect that would've flipped it to "confirmed"
  // hadn't landed yet. Nothing deletes on this field's account anymore — kept only as the hold's
  // creation-time reference.
  expiresAt: { type: Date, default: Date.now },
  cancelledAt: { type: Date },

  // Set when an admin cancels a booking — whether the SumUp refund actually went through.
  refundStatus: { type: String, enum: ["refunded", "failed", "skipped"] },
  refundAmount: { type: Number },
  refundedAt: { type: Date },
  refundError: { type: String },

  // Reporting this completed transaction to Branch.nu for their revenue-share fee tracking.
  // Snapshot the SumUp transaction (not the checkout) once, so retries don't need to hit SumUp again.
  branchTransactionId: { type: String },
  branchTransactionAmount: { type: Number },
  branchTransactionTimestamp: { type: Date },
  branchReportStatus: { type: String, enum: ["pending", "sent", "failed"] },
  branchReportAttempts: { type: Number, default: 0 },
  branchReportNextAttemptAt: { type: Date },
  branchReportLastError: { type: String },

  // Only set when an admin cancels a booking whose transaction had already been reported to
  // Branch.nu (branchReportStatus === "sent") — tells Branch to exclude it from billing.
  branchCancellationStatus: { type: String, enum: ["pending", "sent", "failed"] },
  branchCancellationAttempts: { type: Number, default: 0 },
  branchCancellationNextAttemptAt: { type: Date },
  branchCancellationLastError: { type: String },
});

// Enforced at the database level, not just in application code — the actual guarantee that two
// appointments (a fresh booking, an admin reschedule, a subscription renewal — anything) can never
// both hold the same date+time. A "pending" hold counts too, so two customers can't even both be
// mid-checkout for the same slot; only one "expired"/"cancelled" row per slot is unrestricted, since
// those no longer occupy anything. Every write that can set date/time on an active appointment must
// handle the resulting duplicate-key error (Mongo error code 11000) instead of assuming success.
appointmentSchema.index(
  { date: 1, time: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } },
);

module.exports = mongoose.model("Appointment", appointmentSchema);
