const express = require('express');
const cors = require('cors');
const path = require('path');

const appointmentRoutes = require('./routes/appointmentRoutes');

// 1. Initialize app FIRST
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// 2. API Routes
app.use('/api/appointments', appointmentRoutes);

// 3. Serve frontend
app.use(express.static(path.join(__dirname, '../../frontend')));

// 4. Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// API 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Catch-all 404
app.use((req, res) => {
  res.status(404).send('404 - Page Not Found');
});

module.exports = app;