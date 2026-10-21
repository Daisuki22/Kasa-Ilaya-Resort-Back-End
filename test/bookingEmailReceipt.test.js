const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  JWT_SECRET: 'booking-email-test-secret',
  KASA_DB_HOST: '127.0.0.1',
  KASA_DB_PORT: '3306',
  KASA_DB_NAME: 'kasa_test',
  KASA_DB_USER: 'test',
  KASA_DB_PASS: 'test',
  FRONTEND_URL: 'https://kasailaya.example',
});

const { bookingEmailHtml, loadBookingEmailLogoAttachment } = require('../src/services/notifications');

test('booking email embeds an opaque PNG logo for email clients', () => {
  const logo = loadBookingEmailLogoAttachment();
  assert.ok(Buffer.isBuffer(logo.content));
  assert.equal(logo.contentType, 'image/png');
  assert.equal(logo.contentDisposition, 'inline');
  assert.equal(logo.cid, 'kasa-ilaya-receipt-logo');
  assert.equal(logo.content.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('booking notification email renders a printable-style resort payment receipt', () => {
  const html = bookingEmailHtml({
    id: 'booking-1',
    booking_reference: 'KI-MVHT3JMB',
    customer_name: 'Guest Name',
    customer_email: 'guest@example.com',
    customer_phone: '09123456789',
    package_name: 'Package A',
    booking_date: '2026-11-03',
    guest_count: 15,
    included_guest_count: 15,
    total_amount: 7000,
    reservation_fee_amount: 1050,
    payment_type: 'full_payment',
    payment_amount_due: 7000,
    payment_mode: 'GCash Account',
    payment_reference_number: '235456522642',
  });

  assert.match(html, /src="cid:kasa-ilaya-receipt-logo"/);
  assert.match(html, /Kasa Ilaya Resort &amp; Event Place/);
  assert.match(html, /Sitio Pook na Munti/);
  assert.match(html, /KI-MVHT3JMB/);
  assert.match(html, /Fixed pax included/);
  assert.match(html, /Nov 3, 2026/);
  assert.match(html, /Base Package Price[\s\S]*?₱7,000/);
  assert.match(html, /Additional Guest Fee[\s\S]*?₱0/);
  assert.match(html, /Reservation Fee[\s\S]*?₱1,050 \(15%\)/);
  assert.match(html, /Full Payment/);
  assert.match(html, /GCash Account/);
  assert.match(html, /235456522642/);
});
