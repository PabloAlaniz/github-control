import '@testing-library/jest-dom';

// Force en-US locale for Number.toLocaleString so tests are deterministic
// across developer machines (macOS can report es-ES by default, which
// formats 86396 as "86.396" instead of "86,396").
const _toLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (locales, options) {
  return _toLocaleString.call(this, locales || 'en-US', options);
};
