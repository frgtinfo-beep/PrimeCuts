const Appointment = require('../models/Appointment');
const ical = require('ical-generator').default;

// Real prices, kept here so we don't trust whatever price the browser sends us.
// Keep this in sync with the data-price values in frontend/appointment.html.
const SERVICE_PRICES = {
    'Knipbeurt': 25,
    'Knipbeurt Kinderen': 20,
    'Contour': 10,
    'Baard': 10
};

const ADDON_PRICES = {
    'Baard Trimmen': 5
};

// Pull confirmed bookings for frontend UI
const getAppointments = async (req, res) => {
    try {
        const { date } = req.query;
        let query = { status: 'confirmed' };
        if (date) query.date = date;
        
        // Anyone can call this to check open times, so only send back the time, never customer info
        const appointments = await Appointment.find(query).select('date time -_id');
        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// Step 1: create the booking as 'pending' until payment confirms it
const createAppointment = async (req, res) => {
    try {
        const { customerName, customerEmail, customerPhone, service, addons, date, time } = req.body;

        // Work out the price ourselves instead of trusting the price sent from the browser
        const servicePrice = SERVICE_PRICES[service];
        if (servicePrice === undefined) {
            return res.status(400).json({ error: 'Unknown service.' });
        }

        const addonsList = Array.isArray(addons) ? addons : [];
        let addonsTotal = 0;
        for (const addon of addonsList) {
            const addonPrice = ADDON_PRICES[addon];
            if (addonPrice === undefined) {
                return res.status(400).json({ error: `Unknown add-on: ${addon}` });
            }
            addonsTotal += addonPrice;
        }

        const totalPrice = servicePrice + addonsTotal;

        // Check if slot is taken by a confirmed booking
        const existing = await Appointment.findOne({ 
            date, 
            time, 
            status: 'confirmed' 
        });

        if (existing) {
            return res.status(400).json({ error: 'This time slot is already taken.' });
        }

        const newAppointment = await Appointment.create({
            customerName,
            customerEmail,
            customerPhone,
            service,
            addons,
            date,
            time,
            totalPrice,
            status: 'pending' // Auto-deletes after 10 min unless the payment webhook confirms it (see Appointment model)
        });

        // PAYMENT DEV: create the checkout session here and return its URL instead of the response below
        /*
        const session = await stripe.checkout.sessions.create({
            metadata: { appointmentId: newAppointment._id.toString() },
            // ... payment parameters ...
        });
        return res.json({ success: true, paymentUrl: session.url });
        */

        res.status(201).json({ 
            success: true, 
            appointmentId: newAppointment._id,
            message: 'Appointment successfully confirmed and synced!' 
        });

    } catch (error) {
        console.error("Booking Error:", error);
        res.status(500).json({ error: 'Server error while creating appointment' });
    }
};

// Step 2: called by the payment provider once payment goes through
const handlePaymentWebhook = async (req, res) => {
    try {
        // TODO (payment dev): right now anyone could POST here and confirm a booking for free. Check the payment provider's webhook signature first and get appointmentId from that, not straight from the body.
        const { appointmentId } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ error: 'Appointment hold expired or not found.' });
        }

        // Double check race conditions just in case
        const collision = await Appointment.findOne({
            date: appointment.date,
            time: appointment.time,
            status: 'confirmed',
            _id: { $ne: appointment._id }
        });

        if (collision) {
            await Appointment.findByIdAndDelete(appointmentId);
            return res.status(400).json({ error: 'Slot was taken by someone else. Payment refunded.' });
        }

        // Clear expiration timer and lock it in as confirmed
        appointment.status = 'confirmed';
        appointment.expiresAt = undefined; 
        await appointment.save();

        res.status(200).json({ success: true, message: 'Payment verified and appointment confirmed!' });
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

// Step 3: for when a payment is cancelled or fails.
// PAYMENT DEV: uncomment this, add cancelAppointment to module.exports below, and turn on the
// '/cancel' route in appointmentRoutes.js. Call it from the frontend as soon as the payment
// provider's cancel/fail redirect fires, so the slot frees up right away instead of the
// customer's browser having to wait for the 10-min auto-delete.
/*
const cancelAppointment = async (req, res) => {
    try {
        const { appointmentId } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            // Already auto-deleted or never existed, nothing to do
            return res.status(200).json({ success: true, message: 'Nothing to cancel.' });
        }

        // Don't delete a booking that's already been paid for, just in case
        if (appointment.status === 'confirmed') {
            return res.status(400).json({ error: 'This appointment is already confirmed and cannot be cancelled.' });
        }

        await Appointment.findByIdAndDelete(appointmentId);

        res.status(200).json({ success: true, message: 'Booking cancelled, slot released.' });
    } catch (error) {
        console.error("Cancel Error:", error);
        res.status(500).json({ error: 'Cancel processing failed' });
    }
};
*/

// Generates the live WebCal feed for the barber's Apple Calendar (confirmed only)
const getCalendarFeed = async (req, res) => {
    try {
        const appointments = await Appointment.find({ status: 'confirmed' });
        const calendar = ical({ name: 'Primecuts Bookings', timezone: 'Europe/Amsterdam' });

        appointments.forEach(app => {
            const startTime = new Date(`${app.date}T${app.time}:00`);
            const endTime = new Date(startTime.getTime() + 30 * 60000); 
            const addOnsText = app.addons && app.addons.length > 0 ? app.addons.join(', ') : 'None';

            calendar.createEvent({
                start: startTime,
                end: endTime,
                summary: `${app.service} - ${app.customerName}`,
                description: `Customer: ${app.customerName}\nPhone: ${app.customerPhone}\nEmail: ${app.customerEmail}\nAdd-ons: ${addOnsText}\nTotal Price: €${app.totalPrice}`,
                location: 'Primecuts Barbershop'
            });
        });

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.send(calendar.toString());
    } catch (error) {
        res.status(500).send("Error generating calendar feed");
    }
};

module.exports = {
    createAppointment,
    getAppointments,
    getCalendarFeed,
    handlePaymentWebhook
};