const { extractEmailContent, extractUnsubscribeLinks } = require('../emailParser');

jest.mock('../logger');

describe('Email Parser Utils', () => {
  describe('extractEmailContent', () => {
    it('should extract plain text from simple payload', () => {
      const payload = {
        body: {
          data: Buffer.from('Hello World').toString('base64'),
        },
      };

      const result = extractEmailContent(payload);
      expect(result.body).toBe('Hello World');
      expect(result.attachments).toEqual([]);
    });

    it('should extract HTML content and strip tags', () => {
      const html = '<html><body><p>Hello <strong>World</strong></p></body></html>';
      const payload = {
        body: {
          data: Buffer.from(html).toString('base64'),
        },
      };

      const result = extractEmailContent(payload);
      expect(result.body).toBe('Hello World');
    });

    it('should handle multipart messages', () => {
      const payload = {
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('Plain text content').toString('base64'),
            },
          },
          {
            mimeType: 'text/html',
            body: {
              data: Buffer.from('<p>HTML content</p>').toString('base64'),
            },
          },
        ],
      };

      const result = extractEmailContent(payload);
      expect(result.body).toContain('Plain text content');
      expect(result.body).toContain('HTML content');
    });

    it('should handle nested multipart/alternative', () => {
      const payload = {
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: Buffer.from('Nested plain text').toString('base64'),
                },
              },
              {
                mimeType: 'text/html',
                body: {
                  data: Buffer.from('<p>Nested HTML</p>').toString('base64'),
                },
              },
            ],
          },
        ],
      };

      const result = extractEmailContent(payload);
      // The parser keeps the content with longer length
      expect(result.body).toBe('Nested plain text');
    });

    it('should remove script and style tags from HTML', () => {
      const html = `
        <html>
          <head>
            <style>body { color: red; }</style>
          </head>
          <body>
            <p>Content</p>
            <script>alert('hello');</script>
          </body>
        </html>
      `;
      const payload = {
        body: {
          data: Buffer.from(html).toString('base64'),
        },
      };

      const result = extractEmailContent(payload);
      expect(result.body).toBe('Content');
      expect(result.body).not.toContain('script');
      expect(result.body).not.toContain('style');
      expect(result.body).not.toContain('alert');
    });

    it('should track attachments', () => {
      const payload = {
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('Email content').toString('base64'),
            },
          },
          {
            filename: 'document.pdf',
            mimeType: 'application/pdf',
            body: {
              size: 1024,
            },
          },
        ],
      };

      const result = extractEmailContent(payload);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toEqual({
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      });
    });

    it('should handle attachments without body size', () => {
      const payload = {
        parts: [
          {
            filename: 'image.png',
            mimeType: 'image/png',
            body: {},
          },
        ],
      };

      const result = extractEmailContent(payload);
      expect(result.attachments[0].size).toBe(0);
    });

    it('should limit body size to 10000 characters', () => {
      const longText = 'a'.repeat(15000);
      const payload = {
        body: {
          data: Buffer.from(longText).toString('base64'),
        },
      };

      const result = extractEmailContent(payload);
      expect(result.body.length).toBe(10000);
    });

    it('should handle empty payload', () => {
      const payload = {};
      const result = extractEmailContent(payload);
      expect(result.body).toBe('');
      expect(result.attachments).toEqual([]);
    });

    it('should handle parts without body data', () => {
      const payload = {
        parts: [
          {
            mimeType: 'text/plain',
            body: {},
          },
          {
            mimeType: 'text/html',
          },
        ],
      };

      const result = extractEmailContent(payload);
      expect(result.body).toBe('');
    });
  });

  describe('extractUnsubscribeLinks', () => {
    it('should extract link from List-Unsubscribe header', () => {
      const headers = [
        {
          name: 'List-Unsubscribe',
          value: '<https://example.com/unsubscribe?id=123>',
        },
      ];

      const result = extractUnsubscribeLinks('', headers);
      expect(result).toBe('https://example.com/unsubscribe?id=123');
    });

    it('should extract multiple links from List-Unsubscribe header', () => {
      const headers = [
        {
          name: 'List-Unsubscribe',
          value: '<https://example.com/unsubscribe>, <mailto:unsubscribe@example.com>',
        },
      ];

      const result = extractUnsubscribeLinks('', headers);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should extract unsubscribe link from email body', () => {
      const body = 'Click <a href="https://example.com/unsubscribe">here</a> to unsubscribe.';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should extract opt-out link from email body', () => {
      const body = 'To opt-out, visit <a href="https://example.com/opt-out">this link</a>.';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/opt-out');
    });

    it('should extract remove link from email body', () => {
      const body = '<a href="https://example.com/remove-email">Remove from list</a>';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/remove-email');
    });

    it('should extract preference link from email body', () => {
      const body = '<a href="https://example.com/email-preferences">Email Preferences</a>';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/email-preferences');
    });

    it('should handle single quotes in href', () => {
      const body = "<a href='https://example.com/unsubscribe'>Unsubscribe</a>";
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should prefer header links over body links', () => {
      const headers = [
        {
          name: 'List-Unsubscribe',
          value: '<https://header.com/unsubscribe>',
        },
      ];
      const body = '<a href="https://body.com/unsubscribe">Unsubscribe</a>';

      const result = extractUnsubscribeLinks(body, headers);
      expect(result).toBe('https://header.com/unsubscribe');
    });

    it('should return null if no unsubscribe links found', () => {
      const body = 'This email has no unsubscribe link.';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBeNull();
    });

    it('should handle plain text URLs in body', () => {
      const body = 'To unsubscribe: https://example.com/unsubscribe/12345';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe/12345');
    });

    it('should prefer links with unsubscribe in them', () => {
      const body = `
        <a href="https://example.com/preferences">Preferences</a>
        <a href="https://example.com/unsubscribe">Unsubscribe</a>
        <a href="https://example.com/remove">Remove</a>
      `;
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should handle List-Unsubscribe-Post header', () => {
      const headers = [
        {
          name: 'List-Unsubscribe',
          value: '<https://example.com/unsubscribe>',
        },
        {
          name: 'List-Unsubscribe-Post',
          value: 'List-Unsubscribe=One-Click',
        },
      ];

      const result = extractUnsubscribeLinks('', headers);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should handle multiple URL patterns in body', () => {
      const body = `
        To unsubscribe: https://example.com/unsubscribe
        Or click here: <a href="https://example.com/opt-out">opt out</a>
      `;
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should not include duplicate links', () => {
      const body = `
        <a href="https://example.com/unsubscribe">Unsubscribe</a>
        <a href="https://example.com/unsubscribe">Click here to unsubscribe</a>
      `;
      const headers = [
        {
          name: 'List-Unsubscribe',
          value: '<https://example.com/unsubscribe>',
        },
      ];

      const result = extractUnsubscribeLinks(body, headers);
      expect(result).toBe('https://example.com/unsubscribe');
    });

    it('should handle empty headers array', () => {
      const body = '<a href="https://example.com/unsubscribe">Unsubscribe</a>';
      const result = extractUnsubscribeLinks(body, []);
      expect(result).toBe('https://example.com/unsubscribe');
    });
  });
});