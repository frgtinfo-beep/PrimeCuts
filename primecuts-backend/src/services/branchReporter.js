const Appointment = require("../models/Appointment");

// Delays before each retry, keyed by attempt number (1-indexed). After the last one is exhausted
// the report is marked "failed" for manual reconciliation. Spans ~66 minutes total, matching the
// "retry over the following hour" requirement.
const BRANCH_REPORT_BACKOFF_MS = [
  60 * 1000, // retry #2, 1 min after attempt #1
  5 * 60 * 1000, // retry #3, 5 min after attempt #2
  15 * 60 * 1000, // retry #4, 15 min after attempt #3
  45 * 60 * 1000, // retry #5, 45 min after attempt #4
];

// SumUp attaches every payment attempt made against a checkout to its `transactions` array —
// we only want the one that actually succeeded, never the checkout's own resource id.
const extractSuccessfulTransaction = (checkout) => {
  const transactions = Array.isArray(checkout?.transactions) ? checkout.transactions : [];
  return transactions.find((transaction) => transaction.status === "SUCCESSFUL") || null;
};

const reportBody = (appointment) => ({
  client_id: "business-a",
  amount: appointment.branchTransactionAmount,
  currency: "EUR",
  transaction_id: appointment.branchTransactionId,
  timestamp: new Date(appointment.branchTransactionTimestamp).toISOString(),
});

const attemptBranchReport = async (appointment) => {
  const attemptNumber = (appointment.branchReportAttempts || 0) + 1;

  try {
    const response = await fetch(`${process.env.BRANCH_NU_API_URL.replace(/\/$/, "")}/api/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BRANCH_NU_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reportBody(appointment)),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Branch.nu responded with HTTP ${response.status}`);
    }

    appointment.branchReportStatus = "sent";
    appointment.branchReportAttempts = attemptNumber;
    appointment.branchReportNextAttemptAt = undefined;
    appointment.branchReportLastError = undefined;
    await appointment.save();

    console.log(
      `Branch.nu report sent for appointment ${appointment._id} (transaction ${appointment.branchTransactionId}), attempt ${attemptNumber}.`,
    );
  } catch (error) {
    appointment.branchReportAttempts = attemptNumber;
    appointment.branchReportLastError = error.message;

    if (attemptNumber > BRANCH_REPORT_BACKOFF_MS.length) {
      appointment.branchReportStatus = "failed";
      appointment.branchReportNextAttemptAt = undefined;
      console.error(
        `Branch.nu report FAILED PERMANENTLY for appointment ${appointment._id} (transaction ${appointment.branchTransactionId}) after ${attemptNumber} attempts — needs manual reconciliation. Last error: ${error.message}`,
      );
    } else {
      appointment.branchReportNextAttemptAt = new Date(Date.now() + BRANCH_REPORT_BACKOFF_MS[attemptNumber - 1]);
      console.error(
        `Branch.nu report attempt ${attemptNumber} failed for appointment ${appointment._id}: ${error.message}. Retrying at ${appointment.branchReportNextAttemptAt.toISOString()}.`,
      );
    }

    await appointment.save();
  }
};

// Called once, right after an appointment is confirmed. Snapshots the successful SumUp
// transaction onto the appointment (so later retries never need to call SumUp again) and makes
// the first report attempt. Never throws — a Branch.nu outage must never affect the customer's
// already-successful payment.
const scheduleBranchReport = async (appointment, checkout) => {
  if (appointment.branchReportStatus === "sent") {
    return; // already reported — guards against resolveCheckoutStatus somehow running twice
  }

  if (!process.env.BRANCH_NU_API_URL || !process.env.BRANCH_NU_API_KEY) {
    console.error(
      "Branch.nu reporting not configured (missing BRANCH_NU_API_URL/BRANCH_NU_API_KEY) — skipping report for appointment " +
        appointment._id,
    );
    return;
  }

  const transaction = extractSuccessfulTransaction(checkout);
  if (!transaction || !transaction.id) {
    console.error(
      `Branch.nu report skipped for appointment ${appointment._id}: no successful SumUp transaction found on checkout ${appointment.sumupCheckoutId}.`,
    );
    return;
  }

  try {
    appointment.branchTransactionId = transaction.id;
    appointment.branchTransactionAmount = transaction.amount;
    appointment.branchTransactionTimestamp = transaction.timestamp;
    appointment.branchReportStatus = "pending";
    await appointment.save();

    await attemptBranchReport(appointment);
  } catch (error) {
    console.error(`Branch.nu report setup failed for appointment ${appointment._id}: ${error.message}`);
  }
};

// Periodic sweep (see server.js) that picks up anything still pending past its next-attempt time —
// covers both backoff retries and reports that were pending when the process last restarted.
const retryPendingBranchReports = async () => {
  const due = await Appointment.find({
    status: "confirmed",
    branchReportStatus: "pending",
    branchReportNextAttemptAt: { $lte: new Date() },
  });

  for (const appointment of due) {
    await attemptBranchReport(appointment);
  }
};

const attemptBranchCancellation = async (appointment) => {
  const attemptNumber = (appointment.branchCancellationAttempts || 0) + 1;

  try {
    const response = await fetch(
      `${process.env.BRANCH_NU_API_URL.replace(/\/$/, "")}/api/transactions/${encodeURIComponent(appointment.branchTransactionId)}/cancel`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.BRANCH_NU_API_KEY}` },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Branch.nu responded with HTTP ${response.status}`);
    }
    // A 404 means Branch.nu has no record of this transaction (e.g. the original report never
    // actually landed despite branchReportStatus somehow reading "sent") — nothing left to cancel
    // there, so treat it the same as success rather than retrying forever.

    appointment.branchCancellationStatus = "sent";
    appointment.branchCancellationAttempts = attemptNumber;
    appointment.branchCancellationNextAttemptAt = undefined;
    appointment.branchCancellationLastError = undefined;
    await appointment.save();

    console.log(
      `Branch.nu cancellation sent for appointment ${appointment._id} (transaction ${appointment.branchTransactionId}), attempt ${attemptNumber}.`,
    );
  } catch (error) {
    appointment.branchCancellationAttempts = attemptNumber;
    appointment.branchCancellationLastError = error.message;

    if (attemptNumber > BRANCH_REPORT_BACKOFF_MS.length) {
      appointment.branchCancellationStatus = "failed";
      appointment.branchCancellationNextAttemptAt = undefined;
      console.error(
        `Branch.nu cancellation FAILED PERMANENTLY for appointment ${appointment._id} (transaction ${appointment.branchTransactionId}) after ${attemptNumber} attempts — needs manual reconciliation with Branch.nu so it doesn't bill for a cancelled booking. Last error: ${error.message}`,
      );
    } else {
      appointment.branchCancellationNextAttemptAt = new Date(Date.now() + BRANCH_REPORT_BACKOFF_MS[attemptNumber - 1]);
      console.error(
        `Branch.nu cancellation attempt ${attemptNumber} failed for appointment ${appointment._id}: ${error.message}. Retrying at ${appointment.branchCancellationNextAttemptAt.toISOString()}.`,
      );
    }

    await appointment.save();
  }
};

// Called once, right after an admin cancels a booking. Only reports to Branch.nu if the original
// booking transaction was actually reported there in the first place — nothing to cancel otherwise.
// Never throws — a Branch.nu outage must not block the cancellation itself; it just gets picked up
// by the retry sweep instead.
const scheduleBranchCancellation = async (appointment) => {
  if (appointment.branchReportStatus !== "sent" || !appointment.branchTransactionId) {
    return; // Branch.nu never had a record of this booking — nothing to cancel there.
  }

  if (appointment.branchCancellationStatus === "sent") {
    return; // already reported — guards against this somehow running twice
  }

  if (!process.env.BRANCH_NU_API_URL || !process.env.BRANCH_NU_API_KEY) {
    console.error(
      "Branch.nu reporting not configured (missing BRANCH_NU_API_URL/BRANCH_NU_API_KEY) — skipping cancellation report for appointment " +
        appointment._id,
    );
    return;
  }

  try {
    appointment.branchCancellationStatus = "pending";
    await appointment.save();

    await attemptBranchCancellation(appointment);
  } catch (error) {
    console.error(`Branch.nu cancellation setup failed for appointment ${appointment._id}: ${error.message}`);
  }
};

// Periodic sweep counterpart to retryPendingBranchReports, for cancellations still pending past
// their next-attempt time.
const retryPendingBranchCancellations = async () => {
  const due = await Appointment.find({
    status: "cancelled",
    branchCancellationStatus: "pending",
    branchCancellationNextAttemptAt: { $lte: new Date() },
  });

  for (const appointment of due) {
    await attemptBranchCancellation(appointment);
  }
};

module.exports = {
  scheduleBranchReport,
  retryPendingBranchReports,
  scheduleBranchCancellation,
  retryPendingBranchCancellations,
  extractSuccessfulTransaction,
};
