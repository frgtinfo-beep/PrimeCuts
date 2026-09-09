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

module.exports = { APPOINTMENT_DURATION_MINUTES, toMinutes, overlapsBlockedRange };
