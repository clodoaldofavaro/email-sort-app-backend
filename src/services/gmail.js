const { google } = require('googleapis');
const cheerio = require('cheerio');
const db = require('../config/database');
const { categorizeEmail, summarizeEmail } = require('./openai');
const logger = require('../utils/logger');

const getGmailClient = async (userId, accountEmail = null) => {
  try {
    let query = 'SELECT * FROM email_accounts WHERE user_id = $1';
    const params = [userId];

    if (accountEmail) {
      query += ' AND email = $2';
      params.push(accountEmail);
    }

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      throw new Error('No email account found for user');
    }

    const account = result.rows[0];

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
    });

    // Handle token refresh
    oauth2Client.on('tokens', async tokens => {
      if (tokens.access_token) {
        await db.query('UPDATE email_accounts SET access_token = $1 WHERE id = $2', [
          tokens.access_token,
          account.id,
        ]);
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    return { gmail, account };
  } catch (error) {
    logger.error('Error getting Gmail client:', error);
    throw error;
  }
};

const extractEmailContent = payload => {
  let body = '';

  if (payload.body && payload.body.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  } else if (payload.parts) {
    // Handle multipart messages
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
        if (part.body && part.body.data) {
          body += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }
  }

  // Clean HTML if present
  if (body.includes('<')) {
    const $ = cheerio.load(body);
    body = $.text().replace(/\s+/g, ' ').trim();
  }

  return body;
};

const extractUnsubscribeLink = (body, headers) => {
  // Check List-Unsubscribe header first
  const listUnsubscribe = headers.find(h => h.name === 'List-Unsubscribe')?.value;
  if (listUnsubscribe) {
    const match = listUnsubscribe.match(/<(https?:\/\/[^>]+)>/);
    if (match) return match[1];
  }

  // Check email body for unsubscribe links
  const unsubscribePatterns = [
    /href=['"](https?:\/\/[^'"]*unsubscribe[^'"]*)['"]/gi,
    /href=['"](https?:\/\/[^'"]*opt-out[^'"]*)['"]/gi,
    /href=['"](https?:\/\/[^'"]*remove[^'"]*)['"]/gi,
    /(https?:\/\/[^\s]*unsubscribe[^\s]*)/gi,
    /(https?:\/\/[^\s]*opt-out[^\s]*)/gi,
  ];

  for (const pattern of unsubscribePatterns) {
    const match = body.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
};

const processNewEmails = async userId => {
  try {
    logger.info(`Processing emails for user: ${userId}`);

    const { gmail, account } = await getGmailClient(userId);

    // Get user's categories
    const categoriesResult = await db.query('SELECT * FROM categories WHERE user_id = $1', [
      userId,
    ]);

    if (categoriesResult.rows.length === 0) {
      logger.info('No categories found for user:', userId);
      return;
    }

    const categories = categoriesResult.rows;

    // Get unread emails from the last 7 days
    const query = 'is:unread newer_than:7d';
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50,
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      logger.info('No unread emails found for user:', userId);
      return;
    }

    logger.info(`Found ${response.data.messages.length} unread emails for user: ${userId}`);
    let processedCount = 0;

    for (const message of response.data.messages) {
      try {
        // Check if email already processed
        const existingEmail = await db.query(
          'SELECT id FROM emails WHERE gmail_id = $1 AND user_id = $2',
          [message.id, userId]
        );

        if (existingEmail.rows.length > 0) {
          logger.info(`Email ${message.id} already processed, skipping...`);
          continue;
        }

        // Get full email data
        const emailData = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });

        const headers = emailData.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
        const date = headers.find(h => h.name === 'Date')?.value;

        const body = extractEmailContent(emailData.data.payload);
        const unsubscribeLink = extractUnsubscribeLink(body, headers);

        // Categorize email
        const categoryName = await categorizeEmail({ subject, from, body }, categories);
        const category = categories.find(cat => cat.name === categoryName) || categories[0];

        // Summarize email
        const summary = await summarizeEmail({ subject, from, body });

        // Save email to database
        await db.query(
          `INSERT INTO emails (
            user_id, category_id, account_id, gmail_id, subject, sender, body, 
            ai_summary, unsubscribe_link, received_at, processed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            userId,
            category.id,
            account.id,
            message.id,
            subject,
            from,
            body,
            summary,
            unsubscribeLink,
            date ? new Date(date) : new Date(),
          ]
        );

        // Archive email in Gmail
        await gmail.users.messages.modify({
          userId: 'me',
          id: message.id,
          resource: {
            removeLabelIds: ['INBOX'],
          },
        });

        processedCount++;
        logger.info(`Processed email: ${subject} -> ${categoryName}`);

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Error processing email ${message.id}:`, error);
        // Continue processing other emails
      }
    }

    logger.info(`Successfully processed ${processedCount} emails for user: ${userId}`);
  } catch (error) {
    logger.error('Error processing emails:', error);
    throw error;
  }
};

module.exports = { processNewEmails, getGmailClient };
