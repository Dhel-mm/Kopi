const { OrderError } = require("./pricing");

// Online orders can only be handed over (picked up by the customer or the
// Lalamove rider) while the shop is open: Tuesday to Sunday, 4:00 PM to 11:00 PM,
// Philippine time (UTC+8, no daylight saving). Customers type their own date and time.
const HOURS_TEXT = "Tuesday to Sunday, 4:00 PM to 11:00 PM";
const MANILA_OFFSET = 8 * 60 * 60 * 1000;
const OPEN_DAYS = new Set([0, 2, 3, 4, 5, 6]); // Sunday, Tuesday-Saturday; closed Monday
const OPEN_MINUTE = 16 * 60;
const CLOSE_MINUTE = 23 * 60;
const LEAD_MINUTES = 30; // preparation time before the chosen time
const DAYS_AHEAD = 7;
const MINUTE = 60 * 1000;

// Manila calendar fields for an instant, read from a shifted UTC date.
function manila(date) {
  const shifted = new Date(date.getTime() + MANILA_OFFSET);
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}
function instant(year, month, day, minute) {
  return new Date(Date.UTC(year, month, day, 0, minute) - MANILA_OFFSET);
}
function dateText(fields) {
  return `${fields.year}-${String(fields.month + 1).padStart(2, "0")}-${String(fields.day).padStart(2, "0")}`;
}
function timeText(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// As soon as possible is only offered while open, with time to prepare before closing.
function asapAvailable(now = new Date()) {
  const today = manila(now);
  return OPEN_DAYS.has(today.weekday) && today.minute >= OPEN_MINUTE && today.minute <= CLOSE_MINUTE - LEAD_MINUTES;
}

// The earliest time a customer may type: 30 minutes from now, during opening hours.
function earliest(now = new Date()) {
  const ready = new Date(Math.ceil((now.getTime() + LEAD_MINUTES * MINUTE) / (5 * MINUTE)) * 5 * MINUTE);
  const today = manila(now);
  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    const date = manila(instant(today.year, today.month, today.day + offset, 12 * 60));
    if (!OPEN_DAYS.has(date.weekday)) continue;
    const opens = instant(date.year, date.month, date.day, OPEN_MINUTE);
    const closes = instant(date.year, date.month, date.day, CLOSE_MINUTE);
    const candidate = ready > opens ? ready : opens;
    if (candidate <= closes) return candidate;
  }
  return null;
}

function options(now = new Date()) {
  const first = earliest(now);
  const today = manila(now);
  return {
    hours: HOURS_TEXT,
    asap: asapAvailable(now),
    earliest: first ? { date: dateText(manila(first)), time: timeText(manila(first).minute) } : null,
    minDate: dateText(today),
    maxDate: dateText(manila(instant(today.year, today.month, today.day + DAYS_AHEAD - 1, 12 * 60))),
    openTime: timeText(OPEN_MINUTE),
    closeTime: timeText(CLOSE_MINUTE),
    leadMinutes: LEAD_MINUTES
  };
}

// Checks a typed date and time and explains what is wrong with it.
function check(requested, now = new Date()) {
  const at = new Date(typeof requested === "string" ? requested : NaN);
  if (Number.isNaN(at.getTime()) || at.getUTCSeconds() || at.getUTCMilliseconds()) {
    throw new OrderError("Enter a valid date and time.");
  }
  const local = manila(at);
  if (!OPEN_DAYS.has(local.weekday)) {
    throw new OrderError(`We are closed on Mondays. Choose a time during opening hours (${HOURS_TEXT}).`, 409);
  }
  if (local.minute < OPEN_MINUTE || local.minute > CLOSE_MINUTE) {
    throw new OrderError(`Choose a time between 4:00 PM and 11:00 PM (${HOURS_TEXT}).`, 409);
  }
  if (at.getTime() < now.getTime() + LEAD_MINUTES * MINUTE) {
    throw new OrderError(`Choose a time at least ${LEAD_MINUTES} minutes from now so we can prepare your order.`, 409);
  }
  const lastDay = manila(now);
  if (at.getTime() >= instant(lastDay.year, lastDay.month, lastDay.day + DAYS_AHEAD, 0).getTime()) {
    throw new OrderError(`Choose a date within the next ${DAYS_AHEAD} days.`, 409);
  }
  return at.toISOString();
}

// Returns the ISO time to hand the order over, or null for "as soon as possible".
// A missing choice means as soon as possible, or the earliest opening time when closed.
function resolve(requested, now = new Date()) {
  const choice = requested == null || requested === "" ? null : requested;
  if (choice === null || choice === "ASAP") {
    if (asapAvailable(now)) return null;
    if (choice === "ASAP") {
      throw new OrderError(`We are closed right now. Choose a date and time during opening hours (${HOURS_TEXT}).`, 409);
    }
    const first = earliest(now);
    if (!first) throw new OrderError(`No opening times are available. We are open ${HOURS_TEXT}.`, 409);
    return first.toISOString();
  }
  return check(choice, now);
}

module.exports = { options, resolve, check, earliest, asapAvailable, HOURS_TEXT };
