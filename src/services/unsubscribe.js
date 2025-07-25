// services/unsubscribeService.js
const { Stagehand } = require('@browserbasehq/stagehand');
const { z } = require('zod');
const logger = require('../utils/logger');

class UnsubscribeService {
  constructor() {
    this.stagehand = null;
  }

  async initializeStagehand() {
    try {
      this.stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: process.env.BROWSERBASE_API_KEY,
        projectId: process.env.BROWSERBASE_PROJECT_ID,

        modelName: 'gpt-4o',
        modelClientOptions: {
          apiKey: process.env.OPENAI_API_KEY,
        },
        // Enhanced browser configuration to avoid detection
        browserOptions: {
          timeout: 60000, // Increase to 60 seconds
          headless: false, // Run in headed mode for better compatibility
          advancedStealth: true, // Enable stealth mode
          blockAds: true, // Block ads that might interfere
          ignoreHTTPSErrors: true, // Handle any certificate issues
          viewport: {
            width: 1920,
            height: 1080
          },
          deviceScaleFactor: 1,
          locale: 'en-US',
          timezone: 'America/New_York',
          extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        },
      });

      await this.stagehand.init();
      return this.stagehand;
    } catch (error) {
      logger.error('Failed to initialize Stagehand:', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async unsubscribeFromEmail(unsubscribeLink) {
    let stagehand = null;
    let sessionId = null;

    try {
      stagehand = await this.initializeStagehand();
      const page = stagehand.page;
      
      // Get the Browserbase session ID for replay
      sessionId = stagehand.sessionId;
      logger.info(`Browserbase session ID: ${sessionId}`);

      logger.info(`Navigating to unsubscribe link: ${unsubscribeLink}`);

      // Navigate to the unsubscribe page with retry logic
      const maxRetries = 3;
      let lastError = null;
      
      for (let i = 0; i < maxRetries; i++) {
        try {
          // Add a small delay before navigation to appear more human-like
          if (i > 0) {
            await page.waitForTimeout(2000);
          }
          
          await page.goto(unsubscribeLink, {
            waitUntil: 'domcontentloaded', // Less strict than networkidle
            timeout: 60000, // Increase to 60 seconds
          });
          
          // Check if we hit an error page immediately
          const currentUrl = page.url();
          logger.info(`Navigated to: ${currentUrl}`);
          
          // Special handling for Substack - wait a bit longer for their JS to load
          if (unsubscribeLink.includes('substack.com')) {
            logger.info('Detected Substack URL, waiting for JavaScript to fully load...');
            await page.waitForTimeout(5000);
          }
          
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          logger.warn(`Navigation attempt ${i + 1} failed:`, { error: error.message });
          if (i < maxRetries - 1) {
            await page.waitForTimeout(3000); // Wait before retry
          }
        }
      }
      
      if (lastError) {
        throw lastError;
      }

      // Wait a moment for the page to fully load
      await page.waitForTimeout(2000);

      // First, let's observe what's on the page
      const pageAnalysis = await page.extract({
        instruction: `Analyze this unsubscribe page and identify what actions are needed. 
        For pageType, use EXACTLY one of these values:
        - "confirmation": if the page shows "You unsubscribed", "You've been unsubscribed", "Sorry to see you go", "Resubscribe" button, or similar confirmation that unsubscribe is complete
        - "already_unsubscribed": if the page shows you were already unsubscribed previously or shows a "Resubscribe" option
        - "form": if there is a form with toggles, checkboxes, or inputs to manage email preferences
        - "button": if there is a button to click to confirm unsubscribe (like "Unsubscribe" button)
        - "error": if showing an error page
        
        Important: 
        - If the page shows email preferences with toggle switches that are OFF, this likely means unsubscribe is already complete - use "confirmation"
        - If you see a "Resubscribe" button, this means unsubscribe is complete - use "confirmation"`,
        schema: z.object({
          pageType: z.enum(['form', 'button', 'confirmation', 'already_unsubscribed', 'error']),
          description: z.string(),
          actionRequired: z.boolean(),
          errorMessage: z.string().optional(),
          hasResubscribeButton: z.boolean().optional(),
        }),
      });

      logger.info('Page analysis:', pageAnalysis);

      // Handle different types of unsubscribe pages
      switch (pageAnalysis.pageType) {
        case 'already_unsubscribed':
          const alreadyUnsubscribedResult = {
            success: true,
            message: 'Already unsubscribed',
            details: pageAnalysis.description,
            sessionId: sessionId,
          };
          logger.info('Unsubscribe result - already unsubscribed:', alreadyUnsubscribedResult);
          return alreadyUnsubscribedResult;

        case 'confirmation':
          const confirmationResult = {
            success: true,
            message: 'Unsubscribed successfully',
            details: pageAnalysis.description,
            sessionId: sessionId,
          };
          logger.info('Unsubscribe result - confirmation page:', confirmationResult);
          return confirmationResult;

        case 'error':
          const errorPageResult = {
            success: false,
            message: 'Error on unsubscribe page',
            details: pageAnalysis.errorMessage || pageAnalysis.description,
            sessionId: sessionId,
          };
          logger.error('Unsubscribe result - error page:', errorPageResult);
          return errorPageResult;

        case 'form':
        case 'button':
          // Try to complete the unsubscribe process
          await this.performUnsubscribeAction(page);

          // Wait for the action to complete (longer for modal animations)
          await page.waitForTimeout(5000);

          // Check the result - specifically look for Resubscribe button or confirmation
          const result = await page.extract({
            instruction: `Check if the unsubscribe was successful. Look for:
            - A "Resubscribe" button (which means unsubscribe worked)
            - Confirmation messages like "You've been unsubscribed"
            - The original "Unsubscribe" button changed to "Resubscribe"
            - Any modal or popup confirmation`,
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
              confirmationText: z.string().optional(),
              hasResubscribeButton: z.boolean().optional(),
            }),
          });

          const actionResult = {
            success: result.success || result.hasResubscribeButton === true,
            message: result.hasResubscribeButton ? 'Successfully unsubscribed (Resubscribe button found)' : result.message,
            details: result.confirmationText || (result.hasResubscribeButton ? 'Unsubscribe button changed to Resubscribe' : ''),
            sessionId: sessionId,
          };
          logger.info('Unsubscribe result after action:', actionResult);
          return actionResult;

        default:
          // Try a generic unsubscribe attempt
          await this.performUnsubscribeAction(page);
          await page.waitForTimeout(3000);

          const genericResult = await page.extract({
            instruction: 'Check if unsubscribe was completed',
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          });

          const genericFinalResult = {
            success: genericResult.success,
            message: genericResult.message,
            details: 'Generic unsubscribe attempt',
            sessionId: sessionId,
          };
          logger.info('Unsubscribe result - generic attempt:', genericFinalResult);
          return genericFinalResult;
      }
    } catch (error) {
      logger.error('Unsubscribe error:', { error: error.message, stack: error.stack });
      const errorResult = {
        success: false,
        message: 'Failed to process unsubscribe',
        details: error.message,
        sessionId: sessionId,
      };
      logger.error('Unsubscribe failed with exception:', errorResult);
      return errorResult;
    } finally {
      // Clean up the browser session
      if (stagehand) {
        try {
          await stagehand.close();
        } catch (closeError) {
          logger.error('Error closing stagehand:', { error: closeError.message });
        }
      }
    }
  }

  async performUnsubscribeAction(page) {
    try {
      // Try multiple common unsubscribe patterns
      const actions = [
        'click the unsubscribe button',
        'click the "Unsubscribe" button',
        'click the confirm unsubscribe button',
        'click the remove me button',
        'click the opt out button',
        'click the button that says "Unsubscribe"',
        'fill out and submit the unsubscribe form',
        'click any button that will unsubscribe me from emails',
      ];

      for (const action of actions) {
        try {
          logger.info(`Attempting action: ${action}`);
          await page.act(action);

          // Wait a bit to see if the action worked
          await page.waitForTimeout(3000);

          // Check if we've been redirected or if there's a success message
          const currentUrl = page.url();
          logger.info(`Current URL after action: ${currentUrl}`);

          // If the action seems to have worked, break out of the loop
          const quickCheck = await page.extract({
            instruction: `Is there any indication that unsubscribe was successful or is in progress? Look for:
              - A modal or popup that appeared
              - The button text changed from "Unsubscribe" to "Resubscribe"
              - A confirmation message
              - A page redirect
              - Any visual change indicating the action was processed`,
            schema: z.object({
              actionWorked: z.boolean(),
              reason: z.string(),
              hasResubscribeButton: z.boolean().optional(),
              modalAppeared: z.boolean().optional(),
            }),
          });

          if (quickCheck.actionWorked || quickCheck.hasResubscribeButton === true) {
            logger.info(`Action succeeded: ${quickCheck.reason}`);
            break;
          }
        } catch (actionError) {
          logger.debug(`Action "${action}" failed:`, { error: actionError.message });
          continue; // Try the next action
        }
      }
    } catch (error) {
      logger.error('Error performing unsubscribe action:', { error: error.message, stack: error.stack });
      throw error;
    }
  }
}

module.exports = new UnsubscribeService();
