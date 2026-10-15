const { pool } = require('../config/database');
const config = require('../config/env');
const { id, now } = require('../utils');
const { getBookingStartDateTime, dateKeyFromDate, addDateKeyDays } = require('./bookingSchedule');
const { sendMail } = require('./mail');

async function createNotification({ email, eventKey, title, description, link, entityId }) {
  if (!email || !eventKey) return false;
  const [result] = await pool.query(
    `INSERT IGNORE INTO notifications
      (id, created_date, user_email, event_key, title, description, link, entity_type, entity_id, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Booking', ?, 0)`,
    [id('notification'), now(), String(email).toLowerCase(), eventKey, title, description, link, entityId]
  );
  return Number(result.affectedRows) > 0;
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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function sendUpcomingBookingReminders() {
  const date = addDateKeyDays(dateKeyFromDate(new Date()), 1);
  if (!date) return;
  const [bookings] = await pool.query(
    `SELECT id, booking_reference, customer_email, customer_name, package_name, DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date, tour_type
     FROM bookings WHERE booking_date=? AND status='confirmed'`,
    [date]
  );

  await Promise.all(bookings.map(async (booking) => {
    const startTime = getBookingStartDateTime(String(booking.booking_date).slice(0, 10), booking.tour_type);
    if (!startTime || !booking.customer_email) return;

    const inserted = await createNotification({
      email: booking.customer_email,
      eventKey: `booking:${booking.id}:reminder:${date}`,
      title: 'Upcoming resort schedule reminder',
      description: `${booking.booking_reference || booking.id} · ${booking.package_name || 'Booking'} is scheduled for ${date}.`,
      link: '/MyBookings',
      entityId: booking.id,
    });
    if (!inserted) return;

    const displayDate = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'full',
    }).format(startTime);
    const displayTime = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit',
    }).format(startTime);
    const origin = String(config.frontendUrl || '').split(',')[0].trim().replace(/\/$/, '');
    const bookingsUrl = origin ? `${origin}/MyBookings` : '/MyBookings';
    const result = await sendMail(
      booking.customer_email,
      'Your Kasa Ilaya Resort booking is tomorrow',
      `<p>Hello ${escapeHtml(booking.customer_name || 'Guest')},</p>
       <p>This is a friendly reminder that your confirmed booking is coming up tomorrow.</p>
       <p><strong>Package:</strong> ${escapeHtml(booking.package_name || 'Resort booking')}<br>
       <strong>Booking reference:</strong> ${escapeHtml(booking.booking_reference || booking.id)}<br>
       <strong>Schedule:</strong> ${escapeHtml(displayDate)} at ${escapeHtml(displayTime)} (Philippine time)</p>
       <p>We look forward to welcoming you. You can review your booking details below.</p>
       <p><a href="${escapeHtml(bookingsUrl)}" style="display:inline-block;background:#0d5558;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-weight:bold;">View my booking</a></p>`,
      'booking_reminder'
    );
    if (!result.sent) console.error('Booking reminder email was not delivered', { bookingId: booking.id, error: result.error });
  }));
}

module.exports = { createNotification, notifySafely, notifyBookingAdmins, sendUpcomingBookingReminders };
