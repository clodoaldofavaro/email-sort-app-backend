// Mock modules before requiring them
jest.mock('../../utils/logger');

describe('OpenAI Service', () => {
  describe('Without API Key', () => {
    let categorizeEmail;
    let summarizeEmail;

    beforeAll(() => {
      // Ensure no API key is set
      delete process.env.OPENAI_API_KEY;
      // Clear module cache and load fresh
      jest.resetModules();
      const openaiModule = require('../openai');
      categorizeEmail = openaiModule.categorizeEmail;
      summarizeEmail = openaiModule.summarizeEmail;
    });

    describe('categorizeEmail', () => {
      it('should return default category when OpenAI is not configured', async () => {
        const categories = [
          { name: 'Work', description: 'Work emails' },
          { name: 'Personal', description: 'Personal emails' }
        ];
        const emailContent = {
          subject: 'Test Email',
          from: 'test@example.com',
          body: 'This is a test email'
        };

        const result = await categorizeEmail(emailContent, categories);

        expect(result).toBe('Work'); // Returns first category
      });

      it('should return Uncategorized when no categories provided', async () => {
        const emailContent = {
          subject: 'Test Email',
          from: 'test@example.com',
          body: 'This is a test email'
        };

        const result = await categorizeEmail(emailContent, []);

        expect(result).toBe('Uncategorized');
      });
    });

    describe('summarizeEmail', () => {
      it('should return basic summary when OpenAI is not configured', async () => {
        const emailContent = {
          subject: 'Test Subject',
          from: 'sender@example.com',
          body: 'This is the email body'
        };

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Email from sender@example.com with subject: Test Subject');
      });

      it('should handle missing fields in basic summary', async () => {
        const emailContent = {};

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Email from Unknown sender with subject: No subject');
      });
    });
  });

  describe('With API Key', () => {
    let categorizeEmail;
    let summarizeEmail;
    let mockOpenAI;

    beforeAll(() => {
      // Set API key
      process.env.OPENAI_API_KEY = 'test-api-key';
      
      // Mock OpenAI constructor
      mockOpenAI = {
        chat: {
          completions: {
            create: jest.fn()
          }
        }
      };

      // Clear module cache
      jest.resetModules();
      
      // Mock the OpenAI module
      jest.doMock('openai', () => {
        return jest.fn().mockImplementation(() => mockOpenAI);
      });

      // Now require the service
      const openaiModule = require('../openai');
      categorizeEmail = openaiModule.categorizeEmail;
      summarizeEmail = openaiModule.summarizeEmail;
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    afterAll(() => {
      delete process.env.OPENAI_API_KEY;
      jest.resetModules();
    });

    describe('categorizeEmail', () => {
      it('should categorize email successfully using OpenAI', async () => {
        const categories = [
          { name: 'Work', description: 'Work related emails' },
          { name: 'Personal', description: 'Personal emails' },
          { name: 'Marketing', description: 'Marketing and promotional emails' }
        ];
        const emailContent = {
          subject: 'Meeting Tomorrow at 10am',
          from: 'boss@company.com',
          body: 'Please join the meeting tomorrow at 10am to discuss the project.'
        };

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Work' } }]
        });

        const result = await categorizeEmail(emailContent, categories);

        expect(result).toBe('Work');
        expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: expect.stringContaining('Meeting Tomorrow at 10am') }],
          max_tokens: 50,
          temperature: 0.1
        });
      });

      it('should handle case-insensitive category matching', async () => {
        const categories = [
          { name: 'Work', description: 'Work emails' },
          { name: 'Personal', description: 'Personal emails' }
        ];
        const emailContent = {
          subject: 'Test',
          from: 'test@example.com',
          body: 'Test'
        };

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'work' } }] // lowercase response
        });

        const result = await categorizeEmail(emailContent, categories);

        expect(result).toBe('Work'); // Should match the proper case
      });

      it('should return Uncategorized when OpenAI returns invalid category', async () => {
        const categories = [
          { name: 'Work', description: 'Work emails' },
          { name: 'Personal', description: 'Personal emails' }
        ];
        const emailContent = {
          subject: 'Test',
          from: 'test@example.com',
          body: 'Test'
        };

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'InvalidCategory' } }]
        });

        const result = await categorizeEmail(emailContent, categories);

        expect(result).toBe('Uncategorized');
      });

      it('should handle OpenAI API errors gracefully', async () => {
        const categories = [
          { name: 'Work', description: 'Work emails' }
        ];
        const emailContent = {
          subject: 'Test',
          from: 'test@example.com',
          body: 'Test'
        };

        mockOpenAI.chat.completions.create.mockRejectedValue(
          new Error('API rate limit exceeded')
        );

        const result = await categorizeEmail(emailContent, categories);

        expect(result).toBe('Uncategorized');
      });

      it('should handle emails with missing fields', async () => {
        const categories = [
          { name: 'Work', description: 'Work emails' }
        ];
        const emailContent = {};

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Work' } }]
        });

        const result = await categorizeEmail(emailContent, categories);

        expect(result).toBe('Work');
        expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
          model: 'gpt-3.5-turbo',
          messages: [{ 
            role: 'user', 
            content: expect.stringContaining('No subject') 
          }],
          max_tokens: 50,
          temperature: 0.1
        });
      });

      it('should handle empty categories gracefully', async () => {
        const emailContent = {
          subject: 'Test',
          from: 'test@example.com',
          body: 'Test'
        };

        const result = await categorizeEmail(emailContent, []);

        expect(result).toBe('Uncategorized');
        // Should not call OpenAI when no categories
        expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
      });
    });

    describe('summarizeEmail', () => {
      it('should summarize email successfully using OpenAI', async () => {
        const emailContent = {
          subject: 'Project Update',
          from: 'manager@company.com',
          body: 'The project is on track. We completed phase 1 and are starting phase 2 next week.'
        };

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ 
            message: { 
              content: 'Project update confirms phase 1 completion and phase 2 starting next week.' 
            } 
          }]
        });

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Project update confirms phase 1 completion and phase 2 starting next week.');
        expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
          model: 'gpt-3.5-turbo',
          messages: [{ 
            role: 'user', 
            content: expect.stringContaining('Project Update') 
          }],
          max_tokens: 100,
          temperature: 0.1
        });
      });

      it('should handle long email content by truncating', async () => {
        const longBody = 'a'.repeat(3000); // Create a 3000 character body
        const emailContent = {
          subject: 'Long Email',
          from: 'sender@example.com',
          body: longBody
        };

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Summary of long email.' } }]
        });

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Summary of long email.');
        
        // Check that the body was truncated to 2000 characters
        const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
        const promptContent = callArgs.messages[0].content;
        expect(promptContent).toContain('a'.repeat(2000));
        expect(promptContent).not.toContain('a'.repeat(2001));
      });

      it('should handle OpenAI API errors gracefully', async () => {
        const emailContent = {
          subject: 'Test',
          from: 'test@example.com',
          body: 'Test content'
        };

        mockOpenAI.chat.completions.create.mockRejectedValue(
          new Error('API error')
        );

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Unable to generate summary - please check email content manually.');
      });

      it('should handle emails with missing fields', async () => {
        const emailContent = {};

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Email with no content.' } }]
        });

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Email with no content.');
        expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
          model: 'gpt-3.5-turbo',
          messages: [{ 
            role: 'user', 
            content: expect.stringContaining('No subject') 
          }],
          max_tokens: 100,
          temperature: 0.1
        });
      });

      it('should trim whitespace from summary', async () => {
        const emailContent = {
          subject: 'Test',
          from: 'test@example.com',
          body: 'Test'
        };

        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: '  Summary with spaces.  ' } }]
        });

        const result = await summarizeEmail(emailContent);

        expect(result).toBe('Summary with spaces.');
      });
    });
  });
});