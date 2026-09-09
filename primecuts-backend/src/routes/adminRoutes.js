const express = require("express");
const router = express.Router();

const {
  login,
  logout,
  checkSession,
  listAppointments,
  cancelAppointmentByAdmin,
  listBlockedTimes,
  createBlockedTime,
  deleteBlockedTime,
} = require("../controllers/adminController");
const { requireAdminApi } = require("../middleware/adminAuth");

router.post("/login", login);
router.post("/logout", logout);
router.get("/session", checkSession);
router.get("/appointments", requireAdminApi, listAppointments);
router.post("/appointments/:appointmentId/cancel", requireAdminApi, cancelAppointmentByAdmin);
router.get("/blocked-times", requireAdminApi, listBlockedTimes);
router.post("/blocked-times", requireAdminApi, createBlockedTime);
router.delete("/blocked-times/:blockedTimeId", requireAdminApi, deleteBlockedTime);

module.exports = router;
