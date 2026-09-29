const passwordRequirements = (value) => {
  const password = String(value || '');
  return {
    length: password.length >= 10,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
};

const isStrongPassword = (value) => Object.values(passwordRequirements(value)).every(Boolean);

module.exports = { isStrongPassword, passwordRequirements };
