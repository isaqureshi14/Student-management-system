const jwt = require('jsonwebtoken');

// Use environment variable for secret; fall back to a long random default for dev
const JWT_SECRET = process.env.JWT_SECRET || 'sr_sch_2026_k9#mPqL@vXn!zTw8$cRdYeH5jBuFoA3sN6gI1';

/**
 * Middleware: verify Bearer JWT and attach req.user = { id, role, linked_id }
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, role: decoded.role, linked_id: decoded.linked_id };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Factory: require one of the given roles after authenticate()
 * Usage: router.get('/path', authenticate, requireRole('OWNER','TEACHER'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, JWT_SECRET };
