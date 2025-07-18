const { extractEmailContent, extractUnsubscribeLinks } = require('../../utils/emailParser');

describe('Email Parser Utils', () => {
  describe('extractEmailContent', () => {
    it('should extract plain text content', () => {
      const payload = {
        body: {
          data: Buffer.from('Hello world').toString('base64')
        }
      };

      const result = extractEmailContent(payload);
      expect(result.body).toBe('Hello world');
    });

    it('should handle multipart messages', () => {
      const payload = {
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
      };

      const result = extractEmailContent(payload);
      expect(result.body).toContain('Plain text content');
    });
  });

  describe('extractUnsubscribeLinks', () => {
    it('should extract unsubscribe links from headers', () => {
      const headers = [
        { name: 'List-Unsubscribe', value: '<https://example.com/unsubscribe>' }
      ];

      const result = extractUnsubscribeLinks('', headers);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should extract unsubscribe links from body', () => {
      const body = 'Click here to <a href="https://example.com/unsubscribe">unsubscribe</a>';
      
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe');
    });
  });
});