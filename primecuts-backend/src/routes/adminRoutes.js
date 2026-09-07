const express = require("express");
const router = express.Router();

const {
  login,
  logout,
  checkSession,
  listAppointments,
  cancelAppointmentByAdmin,
} = require("../controllers/adminController");
const { requireAdminApi } = require("../middleware/adminAuth");

router.post("/login", login);
router.post("/logout", logout);
router.get("/session", checkSession);
router.get("/appointments", requireAdminApi, listAppointments);
router.post("/appointments/:appointmentId/cancel", requireAdminApi, cancelAppointmentByAdmin);

module.exports = router;
