const { default: SumUp } = require("@sumup/sdk");
const { extractSuccessfulTransaction } = require("./branchReporter");

const sumupClient = new SumUp({
  apiKey: process.env.SUMUP_API_KEY || "",
});

// The deposit split only exists on bookings made after that feature shipped — for anything older,
// depositAmount is unset and the customer was actually charged the full totalPrice via SumUp.
const amountActuallyCharged = (appointment) =>
  typeof appointment.depositAmount === "number" ? appointment.depositAmount : appointment.totalPrice;

// branchTransactionId is normally already on the appointment (set as soon as the booking is
// confirmed, independent of whether Branch.nu reporting itself succeeds) — but for older bookings
// from before that existed, fall back to looking the successful transaction up via the checkout.
const resolveTransactionId = async (appointment) => {
  if (appointment.branchTransactionId) {
    return appointment.branchTransactionId;
  }

  if (!appointment.sumupCheckoutId) {
    return null;
  }

  const checkout = await sumupClient.checkouts.get(appointment.sumupCheckoutId);
  const transaction = extractSuccessfulTransaction(checkout);
  return transaction?.id || null;
};

// Attempts a real refund of whatever was actually charged for this booking. Never throws — a
// cancellation must still go through (and the customer still gets notified) even if the refund
// itself fails; the caller surfaces refundStatus so the barber knows to refund manually if needed.
const refundAppointment = async (appointment) => {
  if (!process.env.SUMUP_API_KEY || !process.env.SUMUP_MERCHANT_CODE) {
    return { status: "skipped", reason: "SumUp is not configured (missing SUMUP_API_KEY/SUMUP_MERCHANT_CODE)." };
  }

  try {
    const transactionId = await resolveTransactionId(appointment);
    if (!transactionId) {
      return { status: "skipped", reason: "No successful SumUp transaction found for this booking." };
    }

    const amount = amountActuallyCharged(appointment);
    await sumupClient.transactions.refund(process.env.SUMUP_MERCHANT_CODE, transactionId, { amount });

    console.log(`SumUp refund issued for appointment ${appointment._id} (transaction ${transactionId}, €${amount}).`);
    return { status: "refunded", amount, transactionId };
  } catch (error) {
    console.error(`SumUp refund FAILED for appointment ${appointment._id}: ${error.message} — needs manual refund.`);
    return { status: "failed", reason: error.message };
  }
};

module.exports = { refundAppointment };
