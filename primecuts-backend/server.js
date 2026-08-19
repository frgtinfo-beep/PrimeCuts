require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db'); // Import the database connection

// Connect to MongoDB
connectDB();

// Render sets the PORT dynamically, so we must fall back to 5000 for local development
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'production'} mode on port ${PORT}`);
});