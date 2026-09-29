const { pool } = require('../config/database');
const { id, now } = require('../utils');
const { getBookingStartDateTime } = require('./bookingSchedule');

async function createNotification({ email, eventKey, title, description, link, entityId }) {
  if (!email || !eventKey) return;
  await pool.query(
    `INSERT IGNORE INTO notifications
      (id, created_date, user_email, event_key, title, description, link, entity_type, entity_id, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Booking', ?, 0)`,
    [id('notification'), now(), String(email).toLowerCase(), eventKey, title, description, link, entityId]
  );
}

async function notifySafely(notification) {
  try {
    await createNotification(notification);
  } catch (error) {
    console.error('Notification event could not be stored', { code: error.code, eventKey: notification.eventKey });
  }
}

async function notifyBookingAdmins(booking, event = {}) {
  let admins;
  try {
    [admins] = await pool.query(
      "SELECT email FROM users WHERE disabled=0 AND role IN ('admin','super_admin') AND email IS NOT NULL"
    );
  } catch (error) {
    console.error('Admin notification recipients could not be loaded', { code: error.code });
    return;
  }
  await Promise.all(admins.map(({ email }) => notifySafely({
    email,
    eventKey: event.eventKey || `booking:${booking.id}:received`,
    title: event.title || 'New booking received',
    description: event.description || `${booking.booking_reference || booking.id} · ${booking.customer_name || 'Guest'} · ${booking.package_name || 'Package'} · ${booking.booking_date}`,
    link: `/AdminCalendar?bookingId=${encodeURIComponent(booking.id)}`,
    entityId: booking.id,
  })));
}

async function sendUpcomingBookingReminders() {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [bookings] = await pool.query(
    `SELECT id, booking_reference, customer_email, package_name, DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date, tour_type
     FROM bookings WHERE booking_date=? AND status='confirmed'`,
    [date]
  );
  await Promise.all(bookings.map(async (booking) => {
    if (!getBookingStartDateTime(String(booking.booking_date).slice(0, 10), booking.tour_type)) return;
    await notifySafely({
      email: booking.customer_email,
      eventKey: `booking:${booking.id}:reminder:${date}`,
      title: 'Upcoming resort schedule reminder',
      description: `${booking.booking_reference || booking.id} · ${booking.package_name || 'Booking'} is scheduled for ${date}.`,
      link: '/MyBookings',
      entityId: booking.id,
    });
  }));
}

module.exports = { createNotification, notifySafely, notifyBookingAdmins, sendUpcomingBookingReminders };
