const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  JWT_SECRET: 'booking-status-email-test-secret',
  KASA_DB_HOST: '127.0.0.1',
  KASA_DB_PORT: '3306',
  KASA_DB_NAME: 'kasa_test',
  KASA_DB_USER: 'test',
  KASA_DB_PASS: 'test',
  FRONTEND_URL: 'https://kasailaya.example',
});

const deliveries = [];
const mailPath = require.resolve('../src/services/mail');
require.cache[mailPath] = {
  id: mailPath,
  filename: mailPath,
  loaded: true,
  exports: {
    sendMail: async (...args) => {
      deliveries.push(args);
      return { sent: true };
    },
  },
};

const { sendBookingStatusEmail } = require('../src/services/notifications');
const booking = {
  id: 'booking-1',
  booking_reference: 'KI-MVHT3JMB',
  customer_name: 'Guest Name',
  customer_email: 'guest@example.com',
  package_name: 'Package A',
  booking_date: '2026-11-03',
};

test('confirmed reservations email the guest with a clear confirmation status', async () => {
  const result = await sendBookingStatusEmail(booking, 'confirmed');

  assert.equal(result.sent, true);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0], booking.customer_email);
  assert.match(deliveries[0][1], /^Reservation confirmed - KI-MVHT3JMB/);
  assert.match(deliveries[0][2], /has been confirmed by the resort/);
  assert.match(deliveries[0][2], /look forward to welcoming you/);
  assert.equal(deliveries[0][3], 'booking_confirmed');
});

test('declined reservations email the guest with the decline reason', async () => {
  const result = await sendBookingStatusEmail(booking, 'rejected', 'Payment receipt could not be verified.');

  assert.equal(result.sent, true);
  assert.equal(deliveries.length, 2);
  assert.match(deliveries[1][1], /^Reservation declined - KI-MVHT3JMB/);
  assert.match(deliveries[1][2], /was declined by the resort/);
  assert.match(deliveries[1][2], /Payment receipt could not be verified\./);
  assert.equal(deliveries[1][3], 'booking_rejected');
});
