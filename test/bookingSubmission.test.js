const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findExistingBookingSubmission } = require('../src/services/bookingSubmission');

const fakeDb = (booking) => ({
  async query(sql, values) {
    assert.equal(sql, 'SELECT * FROM bookings WHERE booking_reference=? LIMIT 1');
    assert.deepEqual(values, ['KI-RETRY-1']);
    return [[booking].filter(Boolean)];
  },
});

test('booking retry with the same reference returns only the same customer reservation', async () => {
  const booking = {
    id: 'booking-1',
    booking_reference: 'KI-RETRY-1',
    customer_user_id: 'user-1',
    customer_email: 'guest@example.com',
  };

  assert.equal(await findExistingBookingSubmission(fakeDb(booking), 'KI-RETRY-1', {
    id: 'user-1',
    email: 'guest@example.com',
  }), booking);
  assert.equal(await findExistingBookingSubmission(fakeDb(booking), 'KI-RETRY-1', {
    id: 'legacy-user',
    email: 'GUEST@example.com',
  }), booking);
});

test('booking retry with another customer using an existing reference is rejected', async () => {
  const booking = {
    id: 'booking-1',
    booking_reference: 'KI-RETRY-1',
    customer_user_id: 'user-1',
    customer_email: 'guest@example.com',
  };

  await assert.rejects(
    findExistingBookingSubmission(fakeDb(booking), 'KI-RETRY-1', {
      id: 'user-2',
      email: 'other@example.com',
    }),
    { status: 409, message: 'This booking reference has already been used. Please restart your booking.' }
  );
});

test('booking submission with a new reference continues as a new booking', async () => {
  assert.equal(await findExistingBookingSubmission(fakeDb(null), 'KI-RETRY-1', {
    id: 'user-1',
    email: 'guest@example.com',
  }), null);
});
