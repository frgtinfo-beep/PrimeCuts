const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");

const appointmentRoutes = require("./routes/appointmentRoutes");
const adminRoutes = require("./routes/adminRoutes");

if (!process.env.SESSION_SECRET) {
  console.error(
    "SESSION_SECRET is not set — falling back to a secret generated at boot. Admin sessions " +
      "will all be invalidated (forcing re-login) every time the server restarts. Set SESSION_SECRET " +
      "in the environment to avoid this.",
  );
}

// 1. Initialize app FIRST
const app = express();
app.set("trust proxy", 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || require("crypto").randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // "auto" defers to req.secure per-request instead of NODE_ENV, so it works correctly
      // behind Render/Cloudflare's HTTPS termination without needing NODE_ENV set just right.
      secure: "auto",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  }),
);

// 2. API Routes
app.use("/api/appointments", appointmentRoutes);
app.use("/api/admin", adminRoutes);

// 3. Serve frontend
app.use(express.static(path.join(__dirname, "../../frontend")));

// 4. Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/index.html"));
});

// API 404
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Catch-all 404
app.use((req, res) => {
  res.status(404).send("404 - Page Not Found");
});

module.exports = app;
