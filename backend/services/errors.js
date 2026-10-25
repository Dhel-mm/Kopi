// An order or input problem that can be shown to the user, with its HTTP status.
class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

module.exports = { OrderError };
