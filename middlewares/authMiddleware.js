const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_chama_jwt_key_2026_secured';

/**
 * Middleware to authenticate requests using JWT Bearer token
 * Works for both full user tokens and scoped onboarding tokens
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token missing or invalid',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Account associated with token no longer exists',
      });
    }

    req.user = user;
    req.tokenScope = decoded.scope || 'full';
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session has expired. Please sign in again.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid authorization token',
    });
  }
}

/**
 * Generates signed JWT for onboarding / active sessions
 */
function generateToken(user, scope = 'onboarding') {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      status: user.status,
      scope,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = {
  authenticate,
  generateToken,
};
