const mongoose = require("mongoose");

// A recurring membership. This is a template the renewal sweep (src/services/subscriptionRenewal.js)
// uses to stamp out a real, ordinary Appointment each cycle — it doesn't hold any booking state
// itself, so cancelling/rescheduling a given visit is just the normal appointment-cancel flow and
// never touches this record.
//
// Plans and (placeholder) prices live in src/config/subscriptionPlans.js:
//  - "weekly" / "biweekly": same weekday + time every 7 / 14 days.
//  - "monthly": same day-of-month + time.
// The full schedule is computed from startDate (see services/subscriptionSchedule.js), which is
// also what reserves a subscriber's future seats before they're generated as real appointments.
//
// Billing (services/subscriptionBilling.js): a fixed monthly price charged to the saved card on the
// 1st. Visits are only stamped out as appointments for months that are paid (paidThrough).
const subscriptionSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    frequency: { type: String, enum: ["monthly", "biweekly", "weekly"], default: "monthly" },
    // Date (YYYY-MM-DD) of the first, paid visit — every later occurrence is counted from this.
    startDate: { type: String },
    // Only meaningful for "monthly" (weekly/biweekly just add 7/14 days to startDate, which always
    // keeps the original weekday — no day-of-month math needed there).
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    time: { type: String, required: true }, // HH:MM
    // Monthly price at signup — locked in for this customer, so a later price change in
    // config/subscriptionPlans.js never silently changes what an existing subscriber is charged.
    price: { type: Number, required: true },
    // "pending" until the card is saved and the first month is paid; "expired" if that never
    // happened (frees the seats it was holding); "paused" when a monthly charge stayed unpaid past
    // the grace period (seats freed, no more charges); "cancelled" stops future charges and visits.
    status: { type: String, enum: ["pending", "active", "expired", "paused", "cancelled"], default: "pending" },

    // --- Billing ---
    // SumUp customer + saved card. The token is only usable together with our merchant API key.
    sumupCustomerId: { type: String },
    setupCheckoutId: { type: String }, // the card-saving checkout from signup
    cardToken: { type: String },
    cardLast4: { type: String },
    firstMonthAmount: { type: Number },
    // Last month (YYYY-MM) that's paid for — visits are generated up to the end of this month.
    paidThrough: { type: String },
    // "past_due" while a monthly charge has failed and the grace period is running.
    billingStatus: { type: String, enum: ["ok", "past_due"], default: "ok" },
    pastDueSince: { type: Date },
    pausedAt: { type: Date },
    firstAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    cancelledAt: { type: Date },
    // Set by the renewal sweep (subscriptionRenewal.js) when it can't stamp out the next occurrence
    // because the slot got taken or blocked in the meantime — surfaced in the admin portal instead
    // of only being a server log line, since otherwise this failure was invisible without tailing
    // Render's logs. Cleared automatically as soon as a later sweep succeeds for this membership.
    renewalIssue: { type: String, enum: ["slot_taken", "slot_blocked"] },
    renewalIssueDate: { type: String }, // the occurrence date (YYYY-MM-DD) that couldn't be generated
    renewalIssueAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
