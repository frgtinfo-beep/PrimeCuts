const express = require('express');
const router = express.Router();

const { 
    createAppointment, 
    getAppointments, 
    getCalendarFeed, 
    handlePaymentWebhook 
} = require('../controllers/appointmentController');

router.get('/feed', getCalendarFeed);
router.get('/', getAppointments);
router.post('/', createAppointment); // PAYMENT INTEGRATION: add the Stripe checkout session creation inside createAppointment (see the commented block in appointmentController.js)
router.post('/webhook', handlePaymentWebhook); // Payment confirmation route — point your payment provider's webhook here

// router.post('/cancel', cancelAppointment); // PAYMENT INTEGRATION: uncomment once cancelAppointment is uncommented + exported in appointmentController.js — call this from the frontend when the payment provider's cancel_url/failure redirect fires, to release the held slot immediately instead of waiting out the 10-min

module.exports = router;