const { processNewEmails, getGmailClient } = require('../gmail');
const { google } = require('googleapis');
const db = require('../../config/database');
const { categorizeEmail, summarizeEmail } = require('../openai');

jest.mock('googleapis');
jest.mock('../../config/database');
jest.mock('../openai');
jest.mock('../../utils/logger');

describe('Gmail Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  });

  describe('getGmailClient', () => {
    it('should return gmail client and account for valid user', async () => {
      const mockAccount = {
        id: 1,
        user_id: 123,
        email: 'test@gmail.com',
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      };

      db.query.mockResolvedValue({ rows: [mockAccount] });

      const mockOAuth2Client = {
        setCredentials: jest.fn(),
        on: jest.fn()
      };
      const mockGmail = { users: { messages: { list: jest.fn(), get: jest.fn() } } };

      google.auth.OAuth2 = jest.fn().mockReturnValue(mockOAuth2Client);
      google.gmail = jest.fn().mockReturnValue(mockGmail);

      const result = await getGmailClient(123);

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM email_accounts WHERE user_id = $1',
        [123]
      );
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      });
      expect(result.gmail).toBe(mockGmail);
      expect(result.account).toEqual(mockAccount);
    });

    it('should filter by email if accountEmail is provided', async () => {
      const mockAccount = {
        id: 1,
        user_id: 123,
        email: 'specific@gmail.com',
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      };

      db.query.mockResolvedValue({ rows: [mockAccount] });

      const mockOAuth2Client = {
        setCredentials: jest.fn(),
        on: jest.fn()
      };

      google.auth.OAuth2 = jest.fn().mockReturnValue(mockOAuth2Client);
      google.gmail = jest.fn().mockReturnValue({});

      await getGmailClient(123, 'specific@gmail.com');

      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM email_accounts WHERE user_id = $1 AND email = $2',
        [123, 'specific@gmail.com']
      );
    });

    it('should throw error if no email account found', async () => {
      db.query.mockResolvedValue({ rows: [] });

      await expect(getGmailClient(123)).rejects.toThrow('No email account found for user');
    });

    it('should handle token refresh', async () => {
      const mockAccount = {
        id: 1,
        user_id: 123,
        email: 'test@gmail.com',
        access_token: 'old-token',
        refresh_token: 'refresh-token'
      };

      db.query.mockResolvedValue({ rows: [mockAccount] });

      const mockOAuth2Client = {
        setCredentials: jest.fn(),
        on: jest.fn()
      };

      google.auth.OAuth2 = jest.fn().mockReturnValue(mockOAuth2Client);
      google.gmail = jest.fn().mockReturnValue({});

      await getGmailClient(123);

      const tokensHandler = mockOAuth2Client.on.mock.calls[0][1];
      await tokensHandler({ access_token: 'new-token' });

      expect(db.query).toHaveBeenCalledWith(
        'UPDATE email_accounts SET access_token = $1 WHERE id = $2',
        ['new-token', 1]
      );
    });
  });

  describe('processNewEmails', () => {
    let mockGmailClient;
    let mockOAuth2Client;

    beforeEach(() => {
      mockGmailClient = {
        users: {
          messages: {
            list: jest.fn(),
            get: jest.fn(),
            modify: jest.fn()
          }
        }
      };

      mockOAuth2Client = {
        setCredentials: jest.fn(),
        on: jest.fn()
      };

      google.auth.OAuth2 = jest.fn().mockReturnValue(mockOAuth2Client);
      google.gmail = jest.fn().mockReturnValue(mockGmailClient);
    });

    it('should process unread emails successfully', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };
      const mockCategories = [
        { id: 1, name: 'Work', user_id: 123 },
        { id: 2, name: 'Personal', user_id: 123 }
      ];

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] }) // Get user info
        .mockResolvedValueOnce({ rows: [mockAccount] }) // Get email account
        .mockResolvedValueOnce({ rows: mockCategories }) // Get categories
        .mockResolvedValueOnce({ rows: [] }) // Check if email exists
        .mockResolvedValueOnce({ rows: [] }); // Insert email

      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg123' }]
        }
      });

      mockGmailClient.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg123',
          payload: {
            headers: [
              { name: 'Subject', value: 'Test Email' },
              { name: 'From', value: 'sender@example.com' },
              { name: 'Date', value: 'Thu, 01 Jan 2024 00:00:00 GMT' }
            ],
            body: {
              data: Buffer.from('This is a test email').toString('base64')
            }
          }
        }
      });

      categorizeEmail.mockResolvedValue('Work');
      summarizeEmail.mockResolvedValue('Test email summary');

      await processNewEmails(123);

      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'is:unread newer_than:7d',
        maxResults: 50
      });

      expect(categorizeEmail).toHaveBeenCalledWith(
        {
          subject: 'Test Email',
          from: 'sender@example.com',
          body: 'This is a test email'
        },
        mockCategories
      );

      expect(summarizeEmail).toHaveBeenCalledWith({
        subject: 'Test Email',
        from: 'sender@example.com',
        body: 'This is a test email'
      });

      expect(mockGmailClient.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg123',
        resource: {
          removeLabelIds: ['INBOX']
        }
      });
    });

    it('should skip already processed emails', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };
      const mockCategories = [{ id: 1, name: 'Work', user_id: 123 }];

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [mockAccount] })
        .mockResolvedValueOnce({ rows: mockCategories })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Email already exists

      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg123' }]
        }
      });

      await processNewEmails(123);

      expect(mockGmailClient.users.messages.get).not.toHaveBeenCalled();
      expect(categorizeEmail).not.toHaveBeenCalled();
      expect(summarizeEmail).not.toHaveBeenCalled();
    });

    it('should handle no unread emails', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };
      const mockCategories = [{ id: 1, name: 'Work', user_id: 123 }];

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [mockAccount] })
        .mockResolvedValueOnce({ rows: mockCategories });

      mockGmailClient.users.messages.list.mockResolvedValue({
        data: { messages: [] }
      });

      await processNewEmails(123);

      expect(mockGmailClient.users.messages.get).not.toHaveBeenCalled();
      expect(categorizeEmail).not.toHaveBeenCalled();
    });

    it('should handle no categories', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [mockAccount] })
        .mockResolvedValueOnce({ rows: [] }); // No categories

      await processNewEmails(123);

      expect(mockGmailClient.users.messages.list).not.toHaveBeenCalled();
    });

    it('should extract unsubscribe link from headers', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };
      const mockCategories = [{ id: 1, name: 'Marketing', user_id: 123 }];

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [mockAccount] })
        .mockResolvedValueOnce({ rows: mockCategories })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg123' }]
        }
      });

      mockGmailClient.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg123',
          payload: {
            headers: [
              { name: 'Subject', value: 'Newsletter' },
              { name: 'From', value: 'newsletter@example.com' },
              { name: 'Date', value: 'Thu, 01 Jan 2024 00:00:00 GMT' },
              { name: 'List-Unsubscribe', value: '<https://example.com/unsubscribe>' }
            ],
            body: {
              data: Buffer.from('Newsletter content').toString('base64')
            }
          }
        }
      });

      categorizeEmail.mockResolvedValue('Marketing');
      summarizeEmail.mockResolvedValue('Newsletter summary');

      await processNewEmails(123);

      const insertCall = db.query.mock.calls.find(call =>
        call[0].includes('INSERT INTO emails')
      );
      
      expect(insertCall[1][8]).toBe('https://example.com/unsubscribe'); // unsubscribe_link
      expect(insertCall[1][9]).toBe('pending'); // unsubscribe_status
    });

    it('should handle multipart email messages', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };
      const mockCategories = [{ id: 1, name: 'Work', user_id: 123 }];

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [mockAccount] })
        .mockResolvedValueOnce({ rows: mockCategories })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg123' }]
        }
      });

      mockGmailClient.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg123',
          payload: {
            headers: [
              { name: 'Subject', value: 'Multipart Email' },
              { name: 'From', value: 'sender@example.com' },
              { name: 'Date', value: 'Thu, 01 Jan 2024 00:00:00 GMT' }
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: Buffer.from('Plain text content').toString('base64')
                }
              },
              {
                mimeType: 'text/html',
                body: {
                  data: Buffer.from('<p>HTML content</p>').toString('base64')
                }
              }
            ]
          }
        }
      });

      categorizeEmail.mockResolvedValue('Work');
      summarizeEmail.mockResolvedValue('Multipart email summary');

      await processNewEmails(123);

      expect(categorizeEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Plain text content')
        }),
        mockCategories
      );
    });

    it('should continue processing on individual email errors', async () => {
      const mockUser = { name: 'Test User', email: 'test@example.com' };
      const mockAccount = {
        id: 1,
        email: 'test@gmail.com',
        access_token: 'token',
        refresh_token: 'refresh'
      };
      const mockCategories = [{ id: 1, name: 'Work', user_id: 123 }];

      db.query
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [mockAccount] })
        .mockResolvedValueOnce({ rows: mockCategories })
        .mockResolvedValueOnce({ rows: [] }) // First email check
        .mockResolvedValueOnce({ rows: [] }) // Second email check
        .mockResolvedValueOnce({ rows: [] }); // Second email insert

      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg123' }, { id: 'msg456' }]
        }
      });

      // First email will throw error
      mockGmailClient.users.messages.get
        .mockRejectedValueOnce(new Error('Gmail API error'))
        .mockResolvedValueOnce({
          data: {
            id: 'msg456',
            payload: {
              headers: [
                { name: 'Subject', value: 'Second Email' },
                { name: 'From', value: 'sender2@example.com' },
                { name: 'Date', value: 'Thu, 01 Jan 2024 00:00:00 GMT' }
              ],
              body: {
                data: Buffer.from('Second email content').toString('base64')
              }
            }
          }
        });

      categorizeEmail.mockResolvedValue('Work');
      summarizeEmail.mockResolvedValue('Second email summary');

      await processNewEmails(123);

      // Should have processed the second email despite first one failing
      expect(categorizeEmail).toHaveBeenCalledTimes(1);
      expect(mockGmailClient.users.messages.modify).toHaveBeenCalledTimes(1);
    });
  });
});