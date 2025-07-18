const express = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'https://email-sorting-frontend.fly.dev/callback'
);

// Generate Google OAuth URL
router.get('/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    include_granted_scopes: true
  });

  res.json({ url });
});

// Handle Google OAuth callback
router.post('/google/callback', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const { id, email, name, picture } = userInfo.data;

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
      console.log('New user created:', email);
    } else {
      // Update existing user
      result = await db.query(
        'UPDATE users SET email = $1, name = $2, picture = $3, updated_at = NOW() WHERE google_id = $4 RETURNING *',
        [email, name, picture, id]
      );
      user = result.rows[0];
      console.log('Existing user updated:', email);
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
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      token, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(400).json({ 
      error: 'Authentication failed',
      message: error.message 
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
    console.error('Get user error:', error);
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
      refresh_token: account.refresh_token
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    
    // Update stored tokens
    await db.query(
      'UPDATE email_accounts SET access_token = $1 WHERE id = $2',
      [credentials.access_token, account.id]
    );

    res.json({ message: 'Token refreshed successfully' });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;