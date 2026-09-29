function isAdmin(user) {
  return Boolean(user && ['admin', 'super_admin'].includes(user.role || user.app_role));
}

module.exports = { isAdmin };
