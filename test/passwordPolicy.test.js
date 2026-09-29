const test = require('node:test');
const assert = require('node:assert/strict');
const { isStrongPassword, passwordRequirements } = require('../src/services/passwordPolicy');

test('password policy requires ten characters plus upper, lower, number and symbol', () => {
  for (const password of ['', 'Passw1!ab', 'password123!', 'PASSWORD123!', 'PasswordABC!']) {
    assert.equal(isStrongPassword(password), false, `${password} should fail`);
  }
  assert.equal(isStrongPassword('Password123!'), true);
  assert.deepEqual(passwordRequirements('Password123!'), {
    length: true, uppercase: true, lowercase: true, number: true, special: true,
  });
});
