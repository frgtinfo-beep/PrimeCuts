const mongoose = require("mongoose");

// One charge for one month of one subscription — the signup charge (pro-rated first month) and every
// automatic charge on the 1st after that. The unique (subscriptionId, period) index is the actual
// guarantee a customer can never be charged twice for the same month: overlapping billing runs, a
// restart mid-run, or the signup completion firing twice all collide on it instead of charging again.
const subscriptionChargeSchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    period: { type: String, required: true }, // YYYY-MM — the month this charge pays for
    kind: { type: String, enum: ["first", "monthly"], required: true },
    amount: { type: Number, required: true },
    // "processing" while a charge attempt is in flight; "failed" waits for the next retry (or the
    // customer paying via the emailed link); "abandoned" when the grace period ran out.
    status: { type: String, enum: ["processing", "paid", "failed", "abandoned"], default: "processing" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date },
    // Set on the first failure: unpaid after this moment -> the subscription pauses.
    graceUntil: { type: Date },
    lastError: { type: String },
    // The SumUp checkout of the current/last saved-card attempt — checked before any retry, so a
    // charge that went through just before a crash is recognised instead of charged again.
    sumupCheckoutId: { type: String },
    // Hosted checkout emailed to the customer after a failed automatic charge.
    payLinkCheckoutId: { type: String },
    payLinkUrl: { type: String },
    paidAt: { type: Date },
    paidVia: { type: String, enum: ["card_on_file", "pay_link"] },
    transactionId: { type: String },
  },
  { timestamps: true },
);

subscriptionChargeSchema.index({ subscriptionId: 1, period: 1 }, { unique: true });

module.exports = mongoose.model("SubscriptionCharge", subscriptionChargeSchema);
