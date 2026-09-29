const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quoteBooking } = require('../src/services/bookingPricing');

const packageRecord = {
  price: '12000.00',
  day_tour_price: '10000.00',
  night_tour_price: '15000.00',
  twenty_two_hour_price: '20000.00',
  max_guests: 8,
};

test('calculates numeric package, additional guest, reservation fee, and downpayment amounts', () => {
  assert.deepEqual(quoteBooking({
    packageRecord,
    tourType: 'day_tour',
    guestCount: '4',
    paymentType: 'downpayment',
  }), {
    total_amount: 10450,
    reservation_fee_amount: 1567.5,
    payment_type: 'downpayment',
    payment_amount_due: 1567.5,
  });
});

test('calculates full payment and falls back to the package base price when a tour price is absent', () => {
  const quote = quoteBooking({
    packageRecord: { price: '12000.00', day_tour_price: null, max_guests: 5 },
    tourType: 'day_tour',
    guestCount: 2,
    paymentType: 'full_payment',
  });

  assert.equal(quote.total_amount, 12150);
  assert.equal(quote.reservation_fee_amount, 1822.5);
  assert.equal(quote.payment_amount_due, 12150);
});

test('charges only for guests beyond the one included in the package price', () => {
  const quoteForAdditionalGuests = (additionalGuests) => quoteBooking({
    packageRecord: { price: '7000.00', day_tour_price: '7000.00', max_guests: 8 },
    tourType: 'day_tour',
    guestCount: additionalGuests + 1,
    paymentType: 'full_payment',
  });

  assert.equal(quoteForAdditionalGuests(0).total_amount, 7000);
  assert.equal(quoteForAdditionalGuests(1).total_amount, 7150);
  assert.equal(quoteForAdditionalGuests(5).total_amount, 7750);
});

test('allows additional guests beyond package capacity and rejects invalid tour, fractional guests, missing price, and payment type', () => {
  const unlimitedAdditionalGuests = quoteBooking({
    packageRecord: { ...packageRecord, max_guests: 2 },
    tourType: 'day_tour',
    guestCount: 25,
    paymentType: 'full_payment',
  });
  assert.equal(unlimitedAdditionalGuests.total_amount, 13600);

  const invalidQuotes = [
    { tourType: 'invalid', guestCount: 1, paymentType: 'downpayment' },
    { tourType: 'day_tour', guestCount: 1.5, paymentType: 'downpayment' },
    { tourType: 'day_tour', guestCount: 1, paymentType: 'unknown', packageRecord: { price: 0, max_guests: 5 } },
  ];

  for (const quote of invalidQuotes) {
    assert.throws(() => quoteBooking({ packageRecord, paymentType: 'downpayment', ...quote }), { status: 422 });
  }
});
