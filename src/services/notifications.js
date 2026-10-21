const { pool } = require('../config/database');
const config = require('../config/env');
const { id, now } = require('../utils');
const { getBookingStartDateTime, dateKeyFromDate, addDateKeyDays, calendarDaysUntil } = require('./bookingSchedule');
const { sendMail } = require('./mail');
const path = require('node:path');

async function createNotification({ email, eventKey, title, description, link, entityId, actorName, actorProfileImageUrl }) {
  if (!email || !eventKey) return false;
  const [result] = await pool.query(
    `INSERT IGNORE INTO notifications
      (id, created_date, user_email, event_key, title, description, link, entity_type, entity_id, actor_name, actor_profile_image_url, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Booking', ?, ?, ?, 0)`,
    [id('notification'), now(), String(email).toLowerCase(), eventKey, title, description, link, entityId, actorName || 'Kasa Ilaya Resort', actorProfileImageUrl || null]
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
  let actor = null;
  try {
    [admins] = await pool.query(
      "SELECT email FROM users WHERE disabled=0 AND role IN ('admin','super_admin') AND email IS NOT NULL"
    );
    if (booking.customer_email) {
      const [actors] = await pool.query(
        'SELECT full_name,profile_image_url FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1',
        [booking.customer_email]
      );
      actor = actors[0] || null;
    }
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
    actorName: actor?.full_name || booking.customer_name || 'Guest',
    actorProfileImageUrl: actor?.profile_image_url || null,
  })));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function loadBookingReceiptAttachment(booking) {
  const pathname = String(booking?.receipt_url || '').split(/[?#]/, 1)[0];
  const match = pathname.match(/(?:^|\/)uploads\/(.+)$/i);
  if (!match) return [];

  try {
    const fileUrl = `/uploads/${decodeURIComponent(match[1])}`;
    const [rows] = await pool.query(
      'SELECT mime_type,image_data FROM payment_proof_uploads WHERE file_url=? LIMIT 1',
      [fileUrl]
    );
    const image = rows[0]?.image_data;
    if (!image) return [];
    return [{
      filename: path.basename(fileUrl),
      content: Buffer.from(image),
      contentType: rows[0].mime_type || 'application/octet-stream',
      contentDisposition: 'attachment',
    }];
  } catch (error) {
    console.error('Booking payment proof could not be attached to email', { bookingId: booking?.id, code: error.code });
    return [];
  }
}

function bookingEmailHtml(booking, { admin = false, receiptAttached = false } = {}) {
  const tourLabels = {
    day_tour: 'Day Tour (8 AM – 6 PM)',
    night_tour: 'Night Tour (6 PM – 6 AM)',
    '22_hours': '22 Hours (6 PM – 4 PM next day)',
  };
  const dateValue = booking.booking_date instanceof Date
    ? booking.booking_date.toISOString().slice(0, 10)
    : String(booking.booking_date || '').slice(0, 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? new Date(`${dateValue}T12:00:00+08:00`) : null;
  const displayDate = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full' }).format(parsedDate)
    : dateValue || 'To be confirmed';
  const currency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const origin = String(config.frontendUrl || '').split(',')[0].trim().replace(/\/$/, '');
  const bookingsUrl = origin ? `${origin}/MyBookings` : '/MyBookings';
  const rows = [
    ['Booking reference', booking.booking_reference || booking.id],
    ['Guest', booking.customer_name || 'Guest'],
    ...(admin ? [['Email', booking.customer_email || ''], ['Phone', booking.customer_phone || '']] : []),
    ['Package', booking.package_name || 'Resort booking'],
    ['Tour', tourLabels[booking.tour_type] || booking.tour_type || 'To be confirmed'],
    ['Reservation date', displayDate],
    ['Guests', `${Number(booking.guest_count || 0)} (included: ${Number(booking.included_guest_count || 0)})`],
    ['Booking status', 'Pending resort confirmation'],
    ['Payment status', booking.payment_status === 'pending_verification' ? 'Payment proof submitted; pending review' : 'Awaiting payment'],
    ['Payment method', booking.payment_mode || booking.payment_qr_code_label || 'Not provided'],
    ...(booking.payment_reference_number ? [['Payment reference', booking.payment_reference_number]] : []),
    ['Amount submitted', currency(booking.payment_amount_due ?? booking.reservation_fee_amount)],
    ['Total reservation amount', currency(booking.total_amount)],
    ['Reservation fee (15%)', currency(booking.reservation_fee_amount)],
  ];
  const detailRows = rows.map(([label, value], index) => `
    <tr style="background:${index % 2 ? '#ffffff' : '#f5f2eb'}">
      <td style="padding:10px 12px;color:#61716d;width:40%">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;font-weight:600;color:#263735">${escapeHtml(value)}</td>
    </tr>`).join('');
  const specialRequests = booking.special_requests
    ? `<p><strong>Special requests:</strong><br>${escapeHtml(booking.special_requests).replace(/\n/g, '<br>')}</p>`
    : '';
  const receiptNote = booking.receipt_url
    ? `<p>${receiptAttached ? 'The payment receipt you submitted is attached to this email.' : 'Your payment receipt was submitted with this reservation and is awaiting verification.'}</p>`
    : '';

  return `<p>Hello ${escapeHtml(booking.customer_name || 'Guest')},</p>
    <p>${admin ? 'A new reservation was submitted and is awaiting resort review.' : 'We received your reservation request. It is pending resort confirmation; your booking is not confirmed yet.'}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${detailRows}</table>
    ${specialRequests}${receiptNote}
    ${admin ? '' : `<p><a href="${escapeHtml(bookingsUrl)}" style="display:inline-block;background:#0d5558;color:#fff;text-decoration:none;padding:11px 18px;border-radius:7px;font-weight:700">View reservation</a></p>`}
    <p style="font-size:13px;color:#61716d">${admin ? 'Review the submitted payment proof and reservation in the admin dashboard.' : 'We will email you again when the resort updates your booking or payment status.'}</p>`;
}

async function sendBookingSubmissionEmails(booking) {
  const attachments = await loadBookingReceiptAttachment(booking);
  const receiptAttached = attachments.length > 0;
  const customer = await sendMail(
    booking.customer_email,
    `Reservation received - ${booking.booking_reference || booking.id} | Kasa Ilaya Resort`,
    bookingEmailHtml(booking, { receiptAttached }),
    'booking_confirmation',
    attachments
  );

  let adminEmails = [];
  try {
    const [admins] = await pool.query(
      "SELECT email FROM users WHERE disabled=0 AND role IN ('admin','super_admin') AND email IS NOT NULL"
    );
    adminEmails = admins.map((entry) => String(entry.email || '').trim().toLowerCase());
  } catch (error) {
    console.error('Booking email administrators could not be loaded', { bookingId: booking.id, code: error.code });
  }
  const recipients = [...new Set([config.mail.admin, ...adminEmails]
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => email && email !== String(booking.customer_email || '').toLowerCase()))];
  const adminResults = await Promise.all(recipients.map((email) => sendMail(
    email,
    `New reservation - ${booking.booking_reference || booking.id} | Kasa Ilaya Resort`,
    bookingEmailHtml(booking, { admin: true, receiptAttached }),
    'new_booking_admin',
    attachments
  )));

  if (!customer.sent) {
    console.error('Booking confirmation email was not delivered', { bookingId: booking.id, error: customer.error });
  }
  const failedAdmins = adminResults.filter((result) => !result.sent).length;
  if (failedAdmins) console.error('New booking email was not delivered to all admin recipients', { bookingId: booking.id, failed: failedAdmins });
  return { customerEmailSent: customer.sent, customerEmailError: customer.error || '' };
}

async function sendBookingStatusEmail(booking, status, reason = '') {
  const normalizedStatus = String(status || '').toLowerCase();
  if (!booking?.customer_email || !['cancelled', 'rejected'].includes(normalizedStatus)) {
    return { sent: false, error: 'A guest email and a cancelled or rejected booking status are required.' };
  }

  const rejected = normalizedStatus === 'rejected';
  const reference = booking.booking_reference || booking.id || 'your reservation';
  const bookingDate = booking.booking_date instanceof Date
    ? booking.booking_date.toISOString().slice(0, 10)
    : String(booking.booking_date || '').slice(0, 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(bookingDate)
    ? new Date(`${bookingDate}T12:00:00+08:00`)
    : null;
  const displayDate = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full' }).format(parsedDate)
    : bookingDate || 'To be confirmed';
  const origin = String(config.frontendUrl || '').split(',')[0].trim().replace(/\/$/, '');
  const bookingsUrl = origin ? `${origin}/MyBookings` : '/MyBookings';
  const detail = String(reason || booking.rejection_reason || '').trim();
  const statusText = rejected ? 'was not accepted by the resort' : 'has been cancelled';
  const detailHtml = rejected
    ? `<p><strong>Reason:</strong> ${escapeHtml(detail || 'Please contact the resort for more information.')}</p>`
    : detail
      ? `<p>${escapeHtml(detail)}</p>`
      : '<p>This cancellation has been recorded in your reservation.</p>';

  const result = await sendMail(
    booking.customer_email,
    `${rejected ? 'Reservation update' : 'Reservation cancelled'} - ${reference} | Kasa Ilaya Resort`,
    `<p>Hello ${escapeHtml(booking.customer_name || 'Guest')},</p>
     <p>Your reservation <strong>${escapeHtml(reference)}</strong> ${statusText}.</p>
     <p><strong>Package:</strong> ${escapeHtml(booking.package_name || 'Resort booking')}<br>
     <strong>Reservation date:</strong> ${escapeHtml(displayDate)}</p>
     ${detailHtml}
     <p><a href="${escapeHtml(bookingsUrl)}" style="display:inline-block;background:#0d5558;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-weight:bold;">View my bookings</a></p>
     <p>If you have questions, please contact Kasa Ilaya Resort.</p>`,
    rejected ? 'booking_rejected' : 'booking_cancelled'
  );

  if (!result.sent) {
    console.error('Booking status email was not delivered', {
      bookingId: booking.id,
      status: normalizedStatus,
      error: result.error,
    });
  }
  return result;
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

async function sendBookingPolicyReminders() {
  const today = dateKeyFromDate(new Date());
  const lastCancellationDay = addDateKeyDays(today, 8);
  const rangeStart = addDateKeyDays(today, 7);
  if (!lastCancellationDay || !rangeStart) return;

  const [bookings] = await pool.query(
    `SELECT id, booking_reference, customer_email, customer_name, package_name,
            DATE_FORMAT(booking_date,'%Y-%m-%d') AS booking_date, tour_type,
            rebooking_count, rebooking_status
     FROM bookings
     WHERE booking_date BETWEEN ? AND ? AND status IN ('pending','confirmed')`,
    [rangeStart, lastCancellationDay]
  );

  await Promise.all(bookings.map(async (booking) => {
    const bookingDate = String(booking.booking_date || '').slice(0, 10);
    if (calendarDaysUntil(bookingDate, today) !== 8 || !booking.customer_email) return;
    const startTime = getBookingStartDateTime(bookingDate, booking.tour_type);
    if (!startTime) return;

    const cancellationDate = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'full',
    }).format(new Date(`${bookingDate}T00:00:00+08:00`));
    const rescheduleCutoff = new Date(startTime.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rescheduleDateTime = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'full', timeStyle: 'short',
    }).format(rescheduleCutoff);
    const origin = String(config.frontendUrl || '').split(',')[0].trim().replace(/\/$/, '');
    const bookingsUrl = origin ? `${origin}/MyBookings` : '/MyBookings';
    const reference = escapeHtml(booking.booking_reference || booking.id);
    const alreadyRescheduled = Number(booking.rebooking_count || 0) >= 1;
    const reschedulePending = String(booking.rebooking_status || 'none') === 'pending';
    const rescheduleMessage = alreadyRescheduled
      ? '<p>Your one allowed reschedule request has already been used.</p>'
      : reschedulePending
        ? '<p>You already have a reschedule request awaiting resort review. The original booking remains active until it is approved.</p>'
        : `<p>You may submit one reschedule request by <strong>${escapeHtml(rescheduleDateTime)} Philippine time</strong>. Requests are subject to schedule availability and resort approval.</p>`;

    const eventKey = `booking:${booking.id}:policy-deadline:${bookingDate}`;
    const inserted = await createNotification({
      email: booking.customer_email,
      eventKey,
      title: 'Booking cancellation and reschedule deadline',
      description: `Today is the last day to cancel booking ${reference} online. Reschedule deadline: ${rescheduleDateTime} Philippine time.`,
      link: '/MyBookings',
      entityId: booking.id,
    });
    if (!inserted) return;

    const result = await sendMail(
      booking.customer_email,
      'Action needed: booking change deadlines are approaching',
      `<p>Hello ${escapeHtml(booking.customer_name || 'Guest')},</p>
       <p>This is a reminder about the cancellation and rescheduling rules for your active booking.</p>
       <p><strong>Booking reference:</strong> ${reference}<br>
       <strong>Package:</strong> ${escapeHtml(booking.package_name || 'Resort booking')}<br>
       <strong>Reservation date:</strong> ${escapeHtml(cancellationDate)}</p>
       <p><strong>Cancellation:</strong> Today is the last calendar day you can cancel online. Cancellation is unavailable once the reservation is 7 calendar days away. Payments remain non-refundable under the resort policy.</p>
       ${rescheduleMessage}
       <p><a href="${escapeHtml(bookingsUrl)}" style="display:inline-block;background:#0d5558;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-weight:bold;">View my booking</a></p>`,
      'booking_policy_deadline'
    );
    if (!result.sent) console.error('Booking policy reminder email was not delivered', { bookingId: booking.id, error: result.error });
  }));
}

async function sendPendingPaymentVerificationReminders() {
  const today = dateKeyFromDate(new Date());
  const [bookings] = await pool.query(
    `SELECT id, booking_reference, customer_name, package_name
     FROM bookings
     WHERE status='pending' AND payment_status='pending_verification'
       AND created_date < DATE_SUB(NOW(), INTERVAL 1 DAY)`
  );

  await Promise.all(bookings.map((booking) => notifyBookingAdmins(booking, {
    eventKey: `booking:${booking.id}:payment-verification-reminder:${today}`,
    title: 'Payment verification is still pending',
    description: `${booking.booking_reference || booking.id} · ${booking.customer_name || 'Guest'} · ${booking.package_name || 'Booking'} is still waiting for payment verification. Please review the submitted proof.`,
  })));

  return bookings.length;
}

module.exports = {
  createNotification,
  notifySafely,
  notifyBookingAdmins,
  sendBookingSubmissionEmails,
  sendBookingStatusEmail,
  sendUpcomingBookingReminders,
  sendBookingPolicyReminders,
  sendPendingPaymentVerificationReminders,
};
