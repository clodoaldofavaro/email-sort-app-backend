const db = require('../config/database');
const { processNewEmails } = require('../services/gmail');

const scheduleEmailProcessing = async () => {
  try {
    console.log('Starting email processing for all users...');

    const users = await db.query(`
      SELECT DISTINCT u.id, u.email, u.name 
      FROM users u 
      JOIN email_accounts ea ON u.id = ea.user_id
      WHERE ea.access_token IS NOT NULL
    `);

    console.log(`Found ${users.rows.length} users with email accounts`);

    for (const user of users.rows) {
      try {
        console.log(`Processing emails for user: ${user.name} (${user.email})`);
        
        // Get all email accounts for this user
        const emailAccounts = await db.query(
          'SELECT id, email FROM email_accounts WHERE user_id = $1 AND access_token IS NOT NULL',
          [user.id]
        );
        
        console.log(`User ${user.name} has ${emailAccounts.rows.length} connected email accounts`);
        
        // Process emails for each account
        for (const account of emailAccounts.rows) {
          try {
            console.log(`Processing emails from account: ${account.email}`);
            await processNewEmails(user.id, account.email);
          } catch (error) {
            console.error(`Error processing emails for account ${account.email}:`, error);
            // Continue with other accounts
          }
        }
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
