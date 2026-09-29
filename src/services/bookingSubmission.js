async function findExistingBookingSubmission(db, reference, user) {
  const [rows] = await db.query(
    "SELECT * FROM bookings WHERE booking_reference=? LIMIT 1",
    [reference]
  );
  const booking = rows[0] || null;
  if (!booking) return null;

  const sameUserId = String(booking.customer_user_id || "") === String(user?.id || "");
  const sameEmail = String(booking.customer_email || "").toLowerCase() === String(user?.email || "").toLowerCase();
  if (!sameUserId && !sameEmail) {
    throw Object.assign(
      new Error("This booking reference has already been used. Please restart your booking."),
      { status: 409 }
    );
  }

  return booking;
}

module.exports = { findExistingBookingSubmission };
