const { chromium } = require('playwright');
const axios = require('axios');
const logger = require('../utils/logger');

class BrowserbaseService {
  constructor() {
    this.apiKey = process.env.BROWSERBASE_API_KEY;
    this.projectId = process.env.BROWSERBASE_PROJECT_ID;
    this.baseURL = 'https://www.browserbase.com/v1';
  }

  async createSession() {
    try {
      const response = await axios.post(
        `${this.baseURL}/sessions`,
        {
          projectId: this.projectId,
          browserSettings: {
            viewport: { width: 1280, height: 720 },
            keepAlive: true,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Failed to create Browserbase session:', error);
      throw new Error('Failed to create browser session');
    }
  }

  async unsubscribeFromURL(url) {
    // If Browserbase is not configured, fallback to local browser
    if (!this.apiKey || !this.projectId) {
      return await this.localUnsubscribe(url);
    }

    try {
      const session = await this.createSession();

      // Use Browserbase API to navigate and perform unsubscribe
      const response = await axios.post(
        `${this.baseURL}/sessions/${session.id}/actions`,
        {
          actions: [
            { type: 'goto', url: url },
            { type: 'wait', timeout: 3000 },
            {
              type: 'click',
              selector:
                'button:contains("Unsubscribe"), input[type="submit"][value*="unsubscribe"], a:contains("Unsubscribe")',
            },
            { type: 'wait', timeout: 2000 },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Response from Browserbase ', { response });

      // Clean up session
      await this.deleteSession(session.id);

      return {
        success: true,
        message: 'Unsubscribe action completed',
        sessionId: session.id,
      };
    } catch (error) {
      console.error('Browserbase unsubscribe error:', error);
      return {
        success: false,
        error: error.message || 'Failed to perform unsubscribe action',
      };
    }
  }

  async localUnsubscribe(url) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      await page.goto(url, { waitUntil: 'networkidle' });

      // Common unsubscribe patterns
      const unsubscribeSelectors = [
        'button:has-text("Unsubscribe")',
        'button:has-text("UNSUBSCRIBE")',
        'input[type="submit"][value*="unsubscribe" i]',
        'a:has-text("Unsubscribe")',
        'a:has-text("UNSUBSCRIBE")',
        'button:has-text("Opt Out")',
        'button:has-text("Remove")',
        'button:has-text("Stop")',
        '[id*="unsubscribe" i]',
        '[class*="unsubscribe" i]',
      ];

      let clicked = false;
      for (const selector of unsubscribeSelectors) {
        try {
          const element = await page.locator(selector).first();
          if (await element.isVisible()) {
            await element.click();
            clicked = true;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!clicked) {
        return {
          success: false,
          error: 'No unsubscribe button found on the page',
        };
      }

      // Wait for potential navigation or confirmation
      await page.waitForTimeout(3000);

      // Check for confirmation messages
      const confirmationTexts = [
        'unsubscribed',
        'removed',
        'successfully',
        'confirmed',
        'opted out',
      ];

      const pageContent = await page.textContent('body');
      const hasConfirmation = confirmationTexts.some(text =>
        pageContent.toLowerCase().includes(text)
      );

      return {
        success: true,
        message: hasConfirmation ? 'Unsubscribe confirmed' : 'Unsubscribe action completed',
        confirmation: hasConfirmation,
      };
    } catch (error) {
      console.error('Local unsubscribe error:', error);
      return {
        success: false,
        error: error.message || 'Failed to perform unsubscribe action',
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async deleteSession(sessionId) {
    try {
      await axios.delete(`${this.baseURL}/sessions/${sessionId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }
}

// Export functions for use in routes
const processUnsubscribe = async url => {
  const service = new BrowserbaseService();
  return await service.unsubscribeFromURL(url);
};

module.exports = { BrowserbaseService, processUnsubscribe };
