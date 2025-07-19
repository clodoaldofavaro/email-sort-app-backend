const express = require('express');
const { google } = require('googleapis');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { processNewEmails } = require('../services/gmail');

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Get user's connected accounts
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, provider, created_at, updated_at FROM email_accounts WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Add new Gmail account
router.post('/google', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const { email } = userInfo.data;

    // Check if this email is already connected
    const existingAccount = await db.query(
      'SELECT id FROM email_accounts WHERE user_id = $1 AND email = $2',
      [req.user.id, email]
    );

    if (existingAccount.rows.length > 0) {
      return res.status(400).json({ error: 'This email account is already connected' });
    }

    // Add new account
    const result = await db.query(
      `INSERT INTO email_accounts (user_id, email, access_token, refresh_token, provider)
       VALUES ($1, $2, $3, $4, 'google') RETURNING id, email, provider, created_at`,
      [req.user.id, email, tokens.access_token, tokens.refresh_token]
    );

    res.status(201).json({
      message: 'Gmail account connected successfully',
      account: result.rows[0],
    });
  } catch (error) {
    console.error('Error connecting Gmail account:', error);
    res.status(500).json({ error: 'Failed to connect Gmail account' });
  }
});

// Remove connected account
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if this is the last account
    const accountCount = await db.query('SELECT COUNT(*) FROM email_accounts WHERE user_id = $1', [
      req.user.id,
    ]);

    if (parseInt(accountCount.rows[0].count) === 1) {
      return res.status(400).json({
        error:
          'Cannot remove the last connected account. You must have at least one email account connected.',
      });
    }

    const result = await db.query(
      'DELETE FROM email_accounts WHERE id = $1 AND user_id = $2 RETURNING email',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json({
      message: 'Account disconnected successfully',
      removedEmail: result.rows[0].email,
    });
  } catch (error) {
    console.error('Error removing account:', error);
    res.status(500).json({ error: 'Failed to remove account' });
  }
});

// Trigger email processing for specific account
router.post('/:id/process', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify account belongs to user
    const accountResult = await db.query(
      'SELECT email FROM email_accounts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Process emails for this user
    await processNewEmails(req.user.id);

    res.json({
      message: 'Email processing started',
      account: accountResult.rows[0].email,
    });
  } catch (error) {
    console.error('Error processing emails:', error);
    res.status(500).json({ error: 'Failed to process emails' });
  }
});

// Get account statistics
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify account belongs to user
    const accountResult = await db.query(
      'SELECT email FROM email_accounts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const statsResult = await db.query(
      `SELECT 
        COUNT(*) as total_emails,
        COUNT(CASE WHEN unsubscribed = true THEN 1 END) as unsubscribed_count,
        COUNT(DISTINCT sender) as unique_senders,
        MIN(received_at) as oldest_email,
        MAX(received_at) as newest_email
       FROM emails WHERE account_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    res.json({
      account: accountResult.rows[0],
      stats: statsResult.rows[0],
    });
  } catch (error) {
    console.error('Error fetching account stats:', error);
    res.status(500).json({ error: 'Failed to fetch account stats' });
  }
});

// Refresh account tokens
router.post('/:id/refresh', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const accountResult = await db.query(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountResult.rows[0];
    oauth2Client.setCredentials({
      refresh_token: account.refresh_token,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update stored tokens
    await db.query(
      'UPDATE email_accounts SET access_token = $1, updated_at = NOW() WHERE id = $2',
      [credentials.access_token, id]
    );

    res.json({
      message: 'Account tokens refreshed successfully',
      email: account.email,
    });
  } catch (error) {
    console.error('Error refreshing account tokens:', error);
    res.status(500).json({ error: 'Failed to refresh account tokens' });
  }
});

// Test account connection
router.get('/:id/test', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get account details
    const accountResult = await db.query(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountResult.rows[0];

    // Set up OAuth client with stored tokens
    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
    });

    // Try to access Gmail API to test the connection
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    try {
      // Get user's Gmail profile to test connection
      const profile = await gmail.users.getProfile({ userId: 'me' });
      
      // Get a sample of recent messages to show the connection is working
      const messages = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 5,
        q: 'is:unread',
      });

      res.json({
        connected: true,
        status: 'connected',
        account: {
          id: account.id,
          email: account.email,
          provider: account.provider,
        },
        profile: {
          emailAddress: profile.data.emailAddress,
          messagesTotal: profile.data.messagesTotal,
          threadsTotal: profile.data.threadsTotal,
        },
        recentUnreadCount: messages.data.messages ? messages.data.messages.length : 0,
        lastTested: new Date().toISOString(),
      });
    } catch (gmailError) {
      // If Gmail API fails, try to refresh the token
      if (gmailError.code === 401) {
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          
          // Update stored tokens
          await db.query(
            'UPDATE email_accounts SET access_token = $1, updated_at = NOW() WHERE id = $2',
            [credentials.access_token, id]
          );

          res.json({
            connected: true,
            status: 'reconnected',
            message: 'Account tokens were expired but have been refreshed successfully',
            account: {
              id: account.id,
              email: account.email,
              provider: account.provider,
            },
          });
        } catch (refreshError) {
          res.status(401).json({
            connected: false,
            status: 'disconnected',
            error: 'Account authentication failed. Please reconnect the account.',
            account: {
              id: account.id,
              email: account.email,
              provider: account.provider,
            },
          });
        }
      } else {
        throw gmailError;
      }
    }
  } catch (error) {
    console.error('Error testing account connection:', error);
    res.status(500).json({ 
      connected: false,
      status: 'error',
      error: 'Failed to test account connection',
      details: error.message,
    });
  }
});

module.exports = router;
