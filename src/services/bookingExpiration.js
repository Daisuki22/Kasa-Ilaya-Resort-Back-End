const { pool } = require('../config/database');
const { dateKeyFromDate, getBookingEndDateTime } = require('./bookingSchedule');
const { notifySafely } = require('./notifications');

async function synchronizeBookingStatuses() {
  const currentTime = new Date();
  const today = dateKeyFromDate(currentTime);
  const connection = await pool.getConnection();
  let transactionStarted = false;
  let expired = [];
  let completed = [];

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      "SELECT id,booking_reference,customer_email,package_name,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type FROM bookings WHERE status='pending' AND booking_date<=? FOR UPDATE",
      [today]
    );
    expired = rows.filter((booking) => {
      const bookingDate = String(booking.booking_date || '').slice(0, 10);
      const endTime = getBookingEndDateTime(bookingDate, booking.tour_type);
      return endTime && endTime <= currentTime;
    });
    if (expired.length) {
      const placeholders = expired.map(() => '?').join(',');
      await connection.query(
        `UPDATE bookings SET status='cancelled',updated_date=NOW() WHERE status='pending' AND id IN (${placeholders})`,
        expired.map((booking) => booking.id)
      );
    }

    const [paidBookings] = await connection.query(
      "SELECT id,booking_reference,customer_email,package_name,DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date,tour_type FROM bookings WHERE status='confirmed' AND payment_status='paid' AND booking_date<=? FOR UPDATE",
      [today]
    );
    completed = paidBookings.filter((booking) => {
      const bookingDate = String(booking.booking_date || '').slice(0, 10);
      const endTime = getBookingEndDateTime(bookingDate, booking.tour_type);
      return endTime && endTime <= currentTime;
    });
    if (completed.length) {
      const placeholders = completed.map(() => '?').join(',');
      await connection.query(
        `UPDATE bookings SET status='completed',updated_date=NOW() WHERE status='confirmed' AND payment_status='paid' AND id IN (${placeholders})`,
        completed.map((booking) => booking.id)
      );
    }

    await connection.commit();
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch {}
    }
    throw error;
  } finally {
    connection.release();
  }

  await Promise.all(expired.map((booking) => notifySafely({
    email: booking.customer_email,
    eventKey: `booking:${booking.id}:expired:${today}`,
    title: 'Your pending booking expired',
    description: `${booking.booking_reference || booking.id} · ${booking.package_name || 'Booking'} on ${String(booking.booking_date).slice(0, 10)} was cancelled because its date passed before confirmation.`,
    link: '/MyBookings',
    entityId: booking.id,
  })));
  await Promise.all(completed.map((booking) => notifySafely({
    email: booking.customer_email,
    eventKey: `booking:${booking.id}:completed:${String(booking.booking_date).slice(0, 10)}`,
    title: 'Your resort booking is complete',
    description: `${booking.booking_reference || booking.id} · ${booking.package_name || 'Booking'} on ${String(booking.booking_date).slice(0, 10)} has finished. Thank you for visiting Kasa Ilaya Resort.`,
    link: '/MyBookings',
    entityId: booking.id,
  })));
  return { expired: expired.length, completed: completed.length };
}

module.exports = { synchronizeBookingStatuses };
