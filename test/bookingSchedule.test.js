const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getBookingEndDateTime,
  getBookingStartDateTime,
  calendarDaysUntil,
  getOccupiedDateKeys,
  getTourTime,
  isScheduleAvailable,
  isCancellationDateEligible,
  isBookingCancellationAllowed,
  isValidDateKey,
} = require("../src/services/bookingSchedule");

test("accepts real ISO date keys and rejects malformed calendar dates", () => {
  assert.equal(isValidDateKey("2026-10-05"), true);
  assert.equal(isValidDateKey("2026-02-30"), false);
  assert.equal(isValidDateKey("0000-00-00"), false);
  assert.equal(isValidDateKey("10/05/2026"), false);
});

test("cancellation eligibility uses inclusive resort calendar dates and requires more than seven days", () => {
  const today = "2026-10-01";
  assert.equal(calendarDaysUntil("2026-10-31", today), 30);
  assert.equal(calendarDaysUntil("2026-10-09", today), 8);
  assert.equal(calendarDaysUntil("2026-10-08", today), 7);
  assert.equal(calendarDaysUntil("2026-10-07", today), 6);
  assert.equal(calendarDaysUntil("2026-10-02", today), 1);
  assert.equal(calendarDaysUntil(today, today), 0);
  assert.equal(calendarDaysUntil("2026-09-30", today), -1);

  assert.equal(isCancellationDateEligible("2026-10-31", today), true);
  assert.equal(isCancellationDateEligible("2026-10-09", today), true);
  assert.equal(isCancellationDateEligible("2026-10-08", today), false);
  assert.equal(isCancellationDateEligible("2026-10-07", today), false);
  assert.equal(isCancellationDateEligible("2026-10-02", today), false);
  assert.equal(isCancellationDateEligible(today, today), false);
  assert.equal(isCancellationDateEligible("2026-09-30", today), false);
  assert.equal(isCancellationDateEligible("not-a-date", today), false);
});

test("cancellation requires an active booking more than seven resort calendar days away regardless of payment", () => {
  const today = "2026-10-01";
  for (const payment_status of ["paid", "unpaid"]) {
    assert.equal(isBookingCancellationAllowed({ status: "pending", payment_status }, "2026-10-31", today), true);
    assert.equal(isBookingCancellationAllowed({ status: "confirmed", payment_status }, "2026-10-09", today), true);
    assert.equal(isBookingCancellationAllowed({ status: "confirmed", payment_status }, "2026-10-08", today), false);
    assert.equal(isBookingCancellationAllowed({ status: "pending", payment_status }, "2026-10-07", today), false);
  }

  assert.equal(isBookingCancellationAllowed({ status: "pending" }, "2026-10-02", today), false);
  assert.equal(isBookingCancellationAllowed({ status: "pending" }, today, today), false);
  assert.equal(isBookingCancellationAllowed({ status: "confirmed" }, "2026-09-30", today), false);
  assert.equal(isBookingCancellationAllowed({ status: "completed" }, "2026-10-31", today), false);
  assert.equal(isBookingCancellationAllowed({ status: "cancelled" }, "2026-10-31", today), false);
  assert.equal(isBookingCancellationAllowed({ status: "archived" }, "2026-10-31", today), false);
});

test("respects fixed tour windows and Philippine local time", () => {
  assert.deepEqual(getTourTime("day_tour"), {
    start: "08:00",
    end: "18:00",
    label: "8:00 AM - 6:00 PM",
  });
  assert.equal(
    getBookingStartDateTime("2026-10-05", "night_tour").toISOString(),
    "2026-10-05T10:00:00.000Z"
  );
  assert.equal(getBookingEndDateTime("2026-10-05", "day_tour").toISOString(), "2026-10-05T10:00:00.000Z");
  assert.equal(getBookingEndDateTime("2026-10-05", "night_tour").toISOString(), "2026-10-05T22:00:00.000Z");
  assert.equal(getBookingEndDateTime("2026-10-05", "22_hours").toISOString(), "2026-10-06T08:00:00.000Z");
  assert.equal(getTourTime("custom_time"), null);
});

test("detects a previous 22-hour reservation occupying the requested date", () => {
  assert.equal(isScheduleAvailable({
    bookingDate: "2026-10-05",
    tourType: "day_tour",
    bookings: [{ id: "other", booking_date: "2026-10-04", tour_type: "22_hours", status: "confirmed" }],
  }), false);
});

test("checks both dates for 22-hour stays and honors resort event blocks", () => {
  const booking = [{ id: "other", booking_date: "2026-10-06", tour_type: "day_tour", status: "pending" }];
  assert.equal(isScheduleAvailable({ bookingDate: "2026-10-05", tourType: "22_hours", bookings: booking }), false);
  assert.equal(isScheduleAvailable({ bookingDate: "2026-10-05", tourType: "22_hours", manualDates: ["2026-10-06"] }), false);
  assert.equal(isScheduleAvailable({ bookingDate: "2026-10-05", tourType: "day_tour", manualDates: ["2026-10-05"] }), false);
});

test("excludes the booking being moved while still detecting another reservation", () => {
  const bookings = [
    { id: "moving", booking_date: "2026-10-05", tour_type: "day_tour", status: "confirmed" },
    { id: "other", booking_date: "2026-10-05", tour_type: "night_tour", status: "pending" },
  ];

  assert.equal(getOccupiedDateKeys(bookings, [], "moving").has("2026-10-05"), true);
  assert.equal(isScheduleAvailable({
    bookingDate: "2026-10-05",
    tourType: "day_tour",
    bookings: [bookings[0]],
    excludeBookingId: "moving",
  }), true);
  assert.equal(isScheduleAvailable({
    bookingDate: "2026-10-05",
    tourType: "day_tour",
    bookings,
    excludeBookingId: "moving",
  }), false);
});
