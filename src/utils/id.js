const { randomUUID } = require("crypto");

function id() {
  return randomUUID();
}

function nowSql() {
  return new Date();
}

module.exports = { id, nowSql };
