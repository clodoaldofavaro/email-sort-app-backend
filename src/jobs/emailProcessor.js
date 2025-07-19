const db = require('../config/database');
const { processNewEmails } = require('../services/gmail');

const scheduleEmailProcessing = async () => {
  try {
    console.log('Starting email processing for all users...');

    const users = await db.query(`
      SELECT DISTINCT u.id, u.email 
      FROM users u 
      JOIN email_accounts ea ON u.id = ea.user_id
      WHERE ea.access_token IS NOT NULL
    `);

    console.log(`Found ${users.rows.length} users with email accounts`);

    for (const user of users.rows) {
      try {
        await processNewEmails(user.id);
      } catch (error) {
        console.error(`Error processing emails for user ${user.email}:`, error);
        // Continue with other users
      }
    }

    console.log('Email processing completed');
  } catch (error) {
    console.error('Error in scheduled email processing:', error);
  }
};

module.exports = { scheduleEmailProcessing };
