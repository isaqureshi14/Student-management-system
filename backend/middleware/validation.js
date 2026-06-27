const { z } = require('zod');
const sanitizeHtml = require('sanitize-html');

const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    parser: {
      decodeEntities: true
    }
  }).trim();
};

// Fields that must NOT be HTML-sanitized (they are hashed, not rendered as HTML)
const SKIP_SANITIZE_FIELDS = new Set(['password', 'confirm_password', 'new_password', 'current_password']);

const sanitizeObject = (obj) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SKIP_SANITIZE_FIELDS.has(key)) {
      // Passwords must not be altered — they get hashed, not displayed
      sanitized[key] = value;
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

const loginSchema = z.object({
  identifier: z.string().min(1).max(255),
  password: z.string().min(1).max(255),
  role: z.enum(['STUDENT', 'TEACHER', 'PARENT', 'OWNER', 'MANAGER', 'student', 'teacher', 'parent', 'owner', 'manager'])
});

const updateCredentialsSchema = z.object({
  username: z.string().min(3).max(100).regex(/^[a-zA-Z0-9._@-]+$/),
  password: z.string().min(8).max(128).optional()
});

const signupSchema = z.object({
  username: z.string().min(3).max(100).regex(/^[a-zA-Z0-9._@-]+$/),
  password: z.string().min(8).max(128).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  role: z.enum(['STUDENT', 'TEACHER', 'PARENT']),
  linkedId: z.number().int().positive().optional(),
  displayName: z.string().min(1).max(100).optional()
});

function validate(schema) {
  return (req, res, next) => {
    try {
      const sanitized = sanitizeObject(req.body);
      const result = schema.safeParse(sanitized);
      
      if (!result.success) {
        console.warn('Validation failed:', {
          path: req.path,
          ip: req.ip,
          errors: result.error.flatten().fieldErrors
        });
        return res.status(400).json({ error: 'Invalid input data' });
      }
      
      req.body = result.data;
      next();
    } catch (err) {
      console.error('Validation error:', err);
      return res.status(400).json({ error: 'Invalid input data' });
    }
  };
}

module.exports = {
  sanitizeInput,
  sanitizeObject,
  validate,
  loginSchema,
  updateCredentialsSchema,
  signupSchema
};