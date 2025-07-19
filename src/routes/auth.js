const express = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Log Google OAuth configuration status
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  logger.info('✅ Google OAuth configured successfully');
  logger.info('📍 Redirect URI:', process.env.GOOGLE_REDIRECT_URI);
} else {
  logger.warn('⚠️ Google OAuth not fully configured');
}

// Generate Google OAuth URL
router.get('/google', (req, res) => {
  const { state } = req.query; // 'login' or 'add_account'
  
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    include_granted_scopes: true,
    state: state || 'login', // Pass state to identify the flow
  });

  res.json({ url });
});

// Generate Google OAuth URL for adding an account (requires authentication)
router.get('/google/add-account', authenticateToken, (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    include_granted_scopes: true,
    state: `add_account:${req.user.id}`, // Include user ID in state
  });

  res.json({ url });
});

// Handle Google OAuth callback
router.post('/google/callback', async (req, res) => {
  const { code, state } = req.body;

  if (!code) {
    logger.warn('OAuth callback called without authorization code');
    return res.status(400).json({ error: 'Authorization code required' });
  }

  // Log the authorization code (first and last 4 chars for debugging)
  const codePreview = `${code.substring(0, 4)}...${code.substring(code.length - 4)}`;
  const requestTime = new Date().toISOString();
  logger.info(`[${requestTime}] Processing OAuth callback with code: ${codePreview}`);

  try {
    logger.info('Exchanging authorization code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    logger.info(`Successfully obtained tokens for code: ${codePreview}`);
    
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const { id, email, name, picture } = userInfo.data;
    logger.info(`Retrieved user info for: ${email}`);

    // Check if this is an add_account flow
    if (state && state.startsWith('add_account:')) {
      const userId = parseInt(state.split(':')[1]);
      logger.info(`Adding account ${email} for user ID: ${userId}`);
      
      // Check if this email is already connected to this user
      const existingAccount = await db.query(
        'SELECT id FROM email_accounts WHERE user_id = $1 AND email = $2',
        [userId, email]
      );

      if (existingAccount.rows.length > 0) {
        return res.status(400).json({ 
          error: 'This email account is already connected',
          flow: 'add_account'
        });
      }

      // Add new email account
      await db.query(
        `INSERT INTO email_accounts (user_id, email, access_token, refresh_token, provider)
         VALUES ($1, $2, $3, $4, 'google')`,
        [userId, email, tokens.access_token, tokens.refresh_token]
      );

      return res.json({
        success: true,
        flow: 'add_account',
        message: 'Gmail account connected successfully',
        email: email
      });
    }

    // Check if user exists
    let result = await db.query('SELECT * FROM users WHERE google_id = $1', [id]);
    let user;

    if (result.rows.length === 0) {
      // Create new user
      result = await db.query(
        'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) RETURNING *',
        [id, email, name, picture]
      );
      user = result.rows[0];
      logger.info('New user created:', email);
      
      // Create default categories for the new user (matching schema.sql)
      const defaultCategories = [
        { name: 'Newsletters', description: 'Marketing newsletters and promotional emails' },
        { name: 'Social Media', description: 'Notifications from social media platforms' },
        { name: 'Shopping', description: 'E-commerce receipts and promotional offers' },
        { name: 'Work', description: 'Work-related emails and notifications' },
        { name: 'Personal', description: 'Personal emails from friends and family' },
        { name: 'Uncategorized', description: 'Emails that do not fit into any specific category' }
      ];
      
      for (const category of defaultCategories) {
        await db.query(
          'INSERT INTO categories (user_id, name, description) VALUES ($1, $2, $3)',
          [user.id, category.name, category.description]
        );
      }
      logger.info('Default categories created for user:', email);
    } else {
      // Update existing user
      result = await db.query(
        'UPDATE users SET email = $1, name = $2, picture = $3, updated_at = NOW() WHERE google_id = $4 RETURNING *',
        [email, name, picture, id]
      );
      user = result.rows[0];
      logger.info('Existing user updated:', email);
    }

    // Store/update email account
    await db.query(
      `INSERT INTO email_accounts (user_id, email, access_token, refresh_token, provider)
       VALUES ($1, $2, $3, $4, 'google')
       ON CONFLICT (user_id, email) DO UPDATE SET
       access_token = $3, refresh_token = $4, updated_at = NOW()`,
      [user.id, email, tokens.access_token, tokens.refresh_token]
    );

    // Generate JWT
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
    });
  } catch (error) {
    // Enhanced error logging
    if (error.message === 'invalid_grant') {
      logger.error(`Invalid grant error for code: ${codePreview}. This usually means:`);
      logger.error('1. The authorization code was already used');
      logger.error('2. The authorization code has expired');
      logger.error('3. The redirect URI mismatch');
      logger.error('Full error details:', {
        message: error.message,
        code: error.code,
        errors: error.errors,
        config: error.config ? {
          url: error.config.url,
          data: 'REDACTED'
        } : undefined
      });
    } else {
      logger.error(`Auth error for code ${codePreview}:`, error);
    }
    
    res.status(400).json({
      error: 'Authentication failed',
      message: error.message,
    });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, picture, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM email_accounts WHERE user_id = $1 AND provider = $2',
      [req.user.id, 'google']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No Google account found' });
    }

    const account = result.rows[0];
    oauth2Client.setCredentials({
      refresh_token: account.refresh_token,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update stored tokens
    await db.query('UPDATE email_accounts SET access_token = $1 WHERE id = $2', [
      credentials.access_token,
      account.id,
    ]);

    res.json({ message: 'Token refreshed successfully' });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;
