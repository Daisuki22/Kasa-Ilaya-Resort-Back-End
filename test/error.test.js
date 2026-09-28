const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../src/middleware/error');

function invoke(error) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  errorHandler(error, { path: '/api/entities.php' }, response, () => {});
  return response;
}

test('server errors do not expose SQL details to API clients', () => {
  const response = invoke(Object.assign(new Error("Unknown column 'payment_type' in 'field list'"), {
    code: 'ER_BAD_FIELD_ERROR',
    sql: 'INSERT INTO bookings ...',
  }));

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'The server could not complete the request. Please try again.');
  assert.doesNotMatch(JSON.stringify(response.body), /payment_type|INSERT INTO|ER_BAD_FIELD_ERROR/);
});

test('client validation errors retain their useful message', () => {
  const response = invoke(Object.assign(new Error('Booking date must be a valid date.'), { status: 422 }));

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error, 'Booking date must be a valid date.');
});
