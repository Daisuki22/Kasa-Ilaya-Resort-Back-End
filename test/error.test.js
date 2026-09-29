const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../src/middleware/error');

function invoke(error, request = {}) {
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

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    errorHandler(error, {
      method: 'POST',
      path: '/api/entities.php',
      query: { entity: 'Booking' },
      ...request,
    }, response, () => {});
  } finally {
    console.error = originalError;
  }
  return { response, logs };
}

test('production server errors do not expose SQL details to API clients', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const { response, logs } = invoke(Object.assign(new Error("Unknown column 'payment_type' in 'field list'"), {
    code: 'ER_BAD_FIELD_ERROR',
    sql: 'INSERT INTO bookings ...',
  }));
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'The server could not complete the request. Please try again.');
  assert.ok(response.body.request_id);
  assert.doesNotMatch(JSON.stringify(response.body), /payment_type|INSERT INTO|ER_BAD_FIELD_ERROR/);
  assert.match(JSON.stringify(logs), /payment_type/);
  assert.doesNotMatch(JSON.stringify(logs), /INSERT INTO bookings/);
});


test('development server errors return useful SQL diagnostics without raw SQL', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const { response } = invoke(Object.assign(new Error("Unknown column 'payment_type' in 'field list'"), {
    code: 'ER_BAD_FIELD_ERROR',
    sql: 'INSERT INTO bookings ...',
  }));
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  assert.equal(response.body.error_code, 'ER_BAD_FIELD_ERROR');
  assert.match(response.body.details, /payment_type/);
  assert.doesNotMatch(JSON.stringify(response.body), /INSERT INTO bookings/);
});

test('client validation errors retain their useful message', () => {
  const { response } = invoke(Object.assign(new Error('Booking date must be a valid date.'), { status: 422 }));

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error, 'Booking date must be a valid date.');
});
