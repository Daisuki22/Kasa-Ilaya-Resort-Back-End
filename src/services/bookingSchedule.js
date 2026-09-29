const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "completed"];

const dateKeyFromDate = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const isValidDateKey = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const addDateKeyDays = (value, days) => {
  if (!isValidDateKey(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getTourTime = (tourType) => ({
  day_tour: { start: "08:00", end: "18:00", label: "8:00 AM - 6:00 PM" },
  night_tour: { start: "18:00", end: "06:00", label: "6:00 PM - 6:00 AM (next day)" },
  "22_hours": { start: "18:00", end: "16:00", label: "6:00 PM - 4:00 PM (next day)" },
}[tourType] || null);

const getOccupiedDateKeys = (bookings = [], manualDates = [], excludeBookingId = null) => {
  const occupied = new Set(manualDates.filter(isValidDateKey));

  for (const booking of bookings) {
    if (
      booking.id === excludeBookingId ||
      !ACTIVE_BOOKING_STATUSES.includes(booking.status) ||
      !isValidDateKey(booking.booking_date)
    ) continue;

    occupied.add(booking.booking_date);
    if (booking.tour_type === "22_hours") {
      occupied.add(addDateKeyDays(booking.booking_date, 1));
    }
  }

  return occupied;
};

const isScheduleAvailable = ({
  bookingDate,
  tourType,
  bookings = [],
  manualDates = [],
  excludeBookingId = null,
}) => {
  if (!isValidDateKey(bookingDate) || !getTourTime(tourType)) return false;
  const occupied = getOccupiedDateKeys(bookings, manualDates, excludeBookingId);
  const requiredDates = tourType === "22_hours"
    ? [bookingDate, addDateKeyDays(bookingDate, 1)]
    : [bookingDate];

  return requiredDates.every((date) => !occupied.has(date));
};

const getBookingStartDateTime = (bookingDate, tourType) => {
  const time = getTourTime(tourType)?.start;
  if (!time || !isValidDateKey(bookingDate)) return null;
  return new Date(`${bookingDate}T${time}:00+08:00`);
};

const getBookingEndDateTime = (bookingDate, tourType) => {
  const time = getTourTime(tourType)?.end;
  if (!time || !isValidDateKey(bookingDate)) return null;
  const endDate = ['night_tour', '22_hours'].includes(tourType)
    ? addDateKeyDays(bookingDate, 1)
    : bookingDate;
  return new Date(`${endDate}T${time}:00+08:00`);
};

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  addDateKeyDays,
  dateKeyFromDate,
  getBookingEndDateTime,
  getBookingStartDateTime,
  getOccupiedDateKeys,
  getTourTime,
  isScheduleAvailable,
  isValidDateKey,
};
