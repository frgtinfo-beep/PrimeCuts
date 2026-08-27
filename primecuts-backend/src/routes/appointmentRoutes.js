const express = require("express");
const router = express.Router();

const {
  createAppointment,
  getAppointments,
  getCalendarFeed,
  getAppointmentById,
  handlePaymentWebhook,
  cancelAppointment,
} = require("../controllers/appointmentController");

router.get("/feed", getCalendarFeed);
router.post("/webhook", handlePaymentWebhook); // Payment confirmation route — point your payment provider's webhook here
router.post("/cancel", cancelAppointment); // Called by the frontend when the browser returns from checkout, to release a failed/expired hold immediately
router.get("/:appointmentId", getAppointmentById);
router.get("/", getAppointments);
router.post("/", createAppointment);

module.exports = router;
