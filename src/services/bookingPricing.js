const ADDITIONAL_GUEST_RATE = 150;
const RESERVATION_FEE_RATE = 0.15;
const PRICE_FIELDS = {
  day_tour: "day_tour_price",
  night_tour: "night_tour_price",
  "22_hours": "twenty_two_hour_price",
};

function quoteBooking({ packageRecord, tourType, guestCount, paymentType }) {
  const statusError = (message) => Object.assign(new Error(message), { status: 422 });
  const priceField = PRICE_FIELDS[tourType];
  if (!priceField) throw statusError("Choose a valid tour type.");

  const guests = Number(guestCount);
  if (!Number.isSafeInteger(guests) || guests < 1) {
    throw statusError("Guest count must be a whole number greater than zero.");
  }

  const selectedPrice = packageRecord[priceField] ?? packageRecord.price;
  const basePrice = Number(selectedPrice);
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw statusError("The selected package does not have a valid price for this tour.");
  }
  if (!['downpayment', 'full_payment'].includes(paymentType)) {
    throw statusError("Choose a valid payment type.");
  }

  const totalAmount = Number((basePrice + Math.max(guests - 1, 0) * ADDITIONAL_GUEST_RATE).toFixed(2));
  if (!Number.isFinite(totalAmount)) {
    throw statusError("The guest total is too large to calculate.");
  }
  const reservationFee = Number((totalAmount * RESERVATION_FEE_RATE).toFixed(2));

  return {
    total_amount: totalAmount,
    reservation_fee_amount: reservationFee,
    payment_type: paymentType,
    payment_amount_due: paymentType === "full_payment" ? totalAmount : reservationFee,
  };
}

module.exports = { quoteBooking };
