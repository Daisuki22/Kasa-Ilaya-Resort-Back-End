const test = require('node:test');
const assert = require('node:assert/strict');
const { isAdmin } = require('../src/services/authorization');

test('admin authorization checks return a boolean for backend route guards', () => {
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin({ role: 'guest' }), false);
  assert.equal(isAdmin({ role: 'customer' }), false);
  assert.equal(isAdmin({ role: 'admin' }), true);
  assert.equal(isAdmin({ app_role: 'super_admin' }), true);
  assert.equal(isAdmin({ role: 'guest', app_role: 'admin' }), false);
});
