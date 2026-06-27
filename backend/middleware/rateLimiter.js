const rateLimit = require('express-rate-limit');

const failedAttempts = new Map();
const lockouts = new Map();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const BASE_DELAY = 1000; // 1 second base delay

function getClientKey(req) {
  return req.ip || req.connection.remoteAddress || 'unknown';
}

function getLockoutKey(identifier) {
  return `lockout:${identifier.toLowerCase()}`;
}

function getFailedAttemptsKey(identifier) {
  return `failed:${identifier.toLowerCase()}`;
}

function isLockedOut(identifier) {
  const key = getLockoutKey(identifier);
  const lockout = lockouts.get(key);
  if (!lockout) return false;
  
  if (Date.now() > lockout.expiresAt) {
    lockouts.delete(key);
    failedAttempts.delete(getFailedAttemptsKey(identifier));
    return false;
  }
  return true;
}

function getFailedAttempts(identifier) {
  const key = getFailedAttemptsKey(identifier);
  return failedAttempts.get(key) || 0;
}

function recordFailedAttempt(identifier) {
  const key = getFailedAttemptsKey(identifier);
  const attempts = (failedAttempts.get(key) || 0) + 1;
  failedAttempts.set(key, attempts);
  
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const lockoutKey = getLockoutKey(identifier);
    lockouts.set(lockoutKey, {
      expiresAt: Date.now() + LOCKOUT_DURATION,
      attempts
    });
    console.warn(`Account locked out: ${identifier} after ${attempts} failed attempts`);
  }
  
  return attempts;
}

function clearFailedAttempts(identifier) {
  failedAttempts.delete(getFailedAttemptsKey(identifier));
  lockouts.delete(getLockoutKey(identifier));
}

function getProgressiveDelay(attempts) {
  return Math.min(BASE_DELAY * Math.pow(2, attempts - 1), 30000); // Max 30 seconds
}

function loginRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientKey(req),
    handler: (req, res) => {
      console.warn(`Rate limit exceeded for IP: ${getClientKey(req)}`);
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    },
    skip: (req) => {
      if (req.method === 'OPTIONS') return true;
      return false;
    }
  });
}

function accountLockoutMiddleware(req, res, next) {
  const identifier = req.body?.identifier || req.body?.username || req.body?.email;
  
  if (!identifier) {
    return next();
  }
  
  if (isLockedOut(identifier)) {
    console.warn(`Blocked login attempt for locked account: ${identifier}`);
    return res.status(429).json({ error: 'Incorrect email or password' });
  }
  
  next();
}

function applyProgressiveDelay(req, res, next) {
  const identifier = req.body?.identifier || req.body?.username || req.body?.email;
  
  if (!identifier) {
    return next();
  }
  
  const attempts = getFailedAttempts(identifier);
  if (attempts > 0) {
    const delay = getProgressiveDelay(attempts);
    console.info(`Applying progressive delay of ${delay}ms for ${identifier} (attempt ${attempts})`);
    setTimeout(next, delay);
  } else {
    next();
  }
}

function handleLoginResult(identifier, success) {
  if (success) {
    clearFailedAttempts(identifier);
  } else {
    recordFailedAttempt(identifier);
  }
}

module.exports = {
  loginRateLimiter,
  accountLockoutMiddleware,
  applyProgressiveDelay,
  handleLoginResult,
  isLockedOut,
  getFailedAttempts,
  clearFailedAttempts,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION
};