const express = require("express");
const router = express.Router();

const {
  login,
  logout,
  checkSession,
  listAppointments,
  cancelAppointmentByAdmin,
  rescheduleAppointmentByAdmin,
  listBlockedTimes,
  createBlockedTime,
  deleteBlockedTime,
  listSubscriptions,
  cancelSubscriptionByAdmin,
  listPaymentIssues,
} = require("../controllers/adminController");
const { requireAdminApi } = require("../middleware/adminAuth");

router.post("/login", login);
router.post("/logout", logout);
router.get("/session", checkSession);
router.get("/appointments", requireAdminApi, listAppointments);
router.post("/appointments/:appointmentId/cancel", requireAdminApi, cancelAppointmentByAdmin);
router.post("/appointments/:appointmentId/reschedule", requireAdminApi, rescheduleAppointmentByAdmin);
router.get("/blocked-times", requireAdminApi, listBlockedTimes);
router.post("/blocked-times", requireAdminApi, createBlockedTime);
router.delete("/blocked-times/:blockedTimeId", requireAdminApi, deleteBlockedTime);
router.get("/subscriptions", requireAdminApi, listSubscriptions);
router.post("/subscriptions/:subscriptionId/cancel", requireAdminApi, cancelSubscriptionByAdmin);
router.get("/payment-issues", requireAdminApi, listPaymentIssues);

module.exports = router;
