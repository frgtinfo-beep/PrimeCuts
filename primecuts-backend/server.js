require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db'); // Import the database connection
const { retryPendingBranchReports } = require('./src/services/branchReporter');

// Connect to MongoDB
connectDB();

// Render sets the PORT dynamically, so we must fall back to 5000 for local development
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'production'} mode on port ${PORT}`);
});

// Picks up Branch.nu transaction reports that failed and are due for a retry, including any that
// were still pending when the process last restarted.
const BRANCH_REPORT_SWEEP_INTERVAL_MS = 2 * 60 * 1000;
setInterval(() => {
    retryPendingBranchReports().catch((error) => {
        console.error('Branch.nu retry sweep failed:', error.message);
    });
}, BRANCH_REPORT_SWEEP_INTERVAL_MS);