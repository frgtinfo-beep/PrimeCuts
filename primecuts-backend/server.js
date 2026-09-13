require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db'); // Import the database connection
const { retryPendingBranchReports, retryPendingBranchCancellations } = require('./src/services/branchReporter');
const { reconcilePendingCheckouts, reconcileExpiredCheckouts } = require('./src/controllers/appointmentController');
const { generateUpcomingSubscriptionAppointments } = require('./src/services/subscriptionRenewal');

// Connect to MongoDB
connectDB();

// Render sets the PORT dynamically, so we must fall back to 5000 for local development
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'production'} mode on port ${PORT}`);
});

// Picks up Branch.nu transaction reports (and cancellations) that failed and are due for a retry,
// including any that were still pending when the process last restarted.
const BRANCH_REPORT_SWEEP_INTERVAL_MS = 2 * 60 * 1000;
setInterval(() => {
    retryPendingBranchReports().catch((error) => {
        console.error('Branch.nu retry sweep failed:', error.message);
    });
    retryPendingBranchCancellations().catch((error) => {
        console.error('Branch.nu cancellation retry sweep failed:', error.message);
    });
}, BRANCH_REPORT_SWEEP_INTERVAL_MS);

// Confirms/releases any "pending" appointment directly against SumUp, independent of the webhook
// and of the customer's browser making it back to the confirmation page — both of those have a
// single point of failure (a stale redirect URL, a dropped webhook delivery) that previously let a
// genuinely paid appointment sit unconfirmed. Runs often since this is real customer money.
const PAYMENT_RECONCILE_INTERVAL_MS = 20 * 1000;
setInterval(() => {
    reconcilePendingCheckouts().catch((error) => {
        console.error('Payment reconciliation sweep failed:', error.message);
    });
}, PAYMENT_RECONCILE_INTERVAL_MS);

// Self-healing net: re-checks recently-"expired" appointments against SumUp in case a payment
// actually settled after we'd already given up on it (see reconcileExpiredCheckouts for why this
// is what makes the Sept 7 incident structurally unable to repeat). Doesn't need to run as often
// as the pending sweep — a late settlement showing up within a few minutes instead of instantly
// is a fine tradeoff against hitting SumUp's API needlessly.
const EXPIRED_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
    reconcileExpiredCheckouts().catch((error) => {
        console.error('Expired-checkout reconciliation sweep failed:', error.message);
    });
}, EXPIRED_RECONCILE_INTERVAL_MS);

// Stamps out each active membership's next monthly visit once it's due — see subscriptionRenewal.js.
// Runs once on boot too, so a slow/restarted process doesn't leave this waiting a full interval.
const SUBSCRIPTION_RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1000;
generateUpcomingSubscriptionAppointments().catch((error) => {
    console.error('Subscription renewal sweep failed:', error.message);
});
setInterval(() => {
    generateUpcomingSubscriptionAppointments().catch((error) => {
        console.error('Subscription renewal sweep failed:', error.message);
    });
}, SUBSCRIPTION_RENEWAL_INTERVAL_MS);