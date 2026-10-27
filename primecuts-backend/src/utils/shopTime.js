// The shop's own clock, not the server's (Render runs in UTC) — otherwise "today" flips an hour or
// two early/late around midnight, and anything time-of-day based (past slots, when reminders go
// out) is off by the UTC offset.
const SHOP_TIME_ZONE = "Europe/Amsterdam";

function shopNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SHOP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
  };
}

// YYYY-MM-DD plus n days, as plain calendar math (no timezone involved).
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// "maandag 9 november" — how customer-facing emails show a YYYY-MM-DD date.
function formatDateNl(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

module.exports = { SHOP_TIME_ZONE, shopNow, addDays, formatDateNl };
