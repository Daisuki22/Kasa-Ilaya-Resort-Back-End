const { pool } = require('../config/database');
const { dateKeyFromDate } = require('./bookingSchedule');
const { notifySafely } = require('./notifications');

async function expirePastPendingBookings() {
  const today = dateKeyFromDate(new Date());
  const connection = await pool.getConnection();
  let transactionStarted = false;
  let expired = [];

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      "SELECT id,booking_reference,customer_email,package_name,booking_date FROM bookings WHERE status='pending' AND booking_date<? FOR UPDATE",
      [today]
    );
    expired = rows;
    if (expired.length) {
      const placeholders = expired.map(() => '?').join(',');
      await connection.query(
        `UPDATE bookings SET status='cancelled',updated_date=NOW() WHERE status='pending' AND id IN (${placeholders})`,
        expired.map((booking) => booking.id)
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
  return expired.length;
}

module.exports = { expirePastPendingBookings };
