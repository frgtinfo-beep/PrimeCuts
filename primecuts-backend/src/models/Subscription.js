const mongoose = require("mongoose");

// A recurring membership. This is a template the renewal sweep (src/services/subscriptionRenewal.js)
// uses to stamp out a real, ordinary Appointment each cycle — it doesn't hold any booking state
// itself, so cancelling/rescheduling a given visit is just the normal appointment-cancel flow and
// never touches this record.
//
// Two plans:
//  - "monthly": one guaranteed spot a month, same day-of-month + time, €32.50/cut.
//  - "weekly": a guaranteed spot every week (4 a month), same weekday + time, €35.00/cut — the
//    per-cut price is higher since it's 4x the reserved slots.
const subscriptionSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    frequency: { type: String, enum: ["monthly", "weekly"], default: "monthly" },
    // Only meaningful for "monthly" (weekly recurs off the last appointment's date + 7 days, which
    // always preserves the original weekday on its own — no day-of-month math needed there).
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    time: { type: String, required: true }, // HH:MM
    price: { type: Number, required: true },
    // "pending" until the first payment confirms it; "cancelled" stops future renewals but never
    // retroactively cancels appointments already generated.
    status: { type: String, enum: ["pending", "active", "cancelled"], default: "pending" },
    firstAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
