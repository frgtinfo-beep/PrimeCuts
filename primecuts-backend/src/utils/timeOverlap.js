// Every appointment occupies this many minutes for overlap-checking purposes — matches the slot
// spacing on the booking page (frontend/appointment.js's generateTimeSlots interval).
const APPOINTMENT_DURATION_MINUTES = 35;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// True if an appointment starting at `time` on `date` would overlap any of the given blocked
// ranges for that same date. Standard interval-overlap test: they overlap unless one ends before
// (or exactly when) the other starts.
function overlapsBlockedRange(time, blockedRanges) {
  const start = toMinutes(time);
  const end = start + APPOINTMENT_DURATION_MINUTES;

  return blockedRanges.some((range) => {
    const blockStart = toMinutes(range.startTime);
    const blockEnd = toMinutes(range.endTime);
    return start < blockEnd && end > blockStart;
  });
}

// Opening hours as offered on the booking pages (frontend generateTimeSlots): slots every
// APPOINTMENT_DURATION_MINUTES from 11:00, with the last one ending by 19:00. Slot conflicts are
// only checked on exact date+time, so an off-grid time sent straight to the API (e.g. 11:10) would
// overlap the 11:00 appointment without anything noticing — this rejects those.
const OPENING_MINUTES = 11 * 60;
const CLOSING_MINUTES = 19 * 60;

function isBookableSlotTime(time) {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) return false;
  const start = toMinutes(time);
  return (
    start >= OPENING_MINUTES &&
    start + APPOINTMENT_DURATION_MINUTES <= CLOSING_MINUTES &&
    (start - OPENING_MINUTES) % APPOINTMENT_DURATION_MINUTES === 0
  );
}

module.exports = { APPOINTMENT_DURATION_MINUTES, toMinutes, overlapsBlockedRange, isBookableSlotTime };
