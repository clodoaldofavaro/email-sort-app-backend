// services/unsubscribeService.js
const { Stagehand } = require('@browserbasehq/stagehand');
const { z } = require('zod');

class UnsubscribeService {
  constructor() {
    this.stagehand = null;
  }

  async initializeStagehand() {
    if (this.stagehand) return this.stagehand;

    this.stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,

      modelName: 'gpt-4o',
      modelClientOptions: {
        apiKey: process.env.OPENAI_API_KEY,
      },
      // Add timeout and other options
      browserOptions: {
        timeout: 30000,
      },
    });

    await this.stagehand.init();
    return this.stagehand;
  }

  async unsubscribeFromEmail(unsubscribeLink) {
    let stagehand = null;

    try {
      stagehand = await this.initializeStagehand();
      const page = stagehand.page;

      console.log(`Navigating to unsubscribe link: ${unsubscribeLink}`);

      // Navigate to the unsubscribe page
      await page.goto(unsubscribeLink, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait a moment for the page to fully load
      await page.waitForTimeout(2000);

      // First, let's observe what's on the page
      const pageAnalysis = await page.extract({
        instruction: 'Analyze this unsubscribe page and identify what actions are needed',
        schema: z.object({
          pageType: z.enum(['form', 'button', 'confirmation', 'already_unsubscribed', 'error']),
          description: z.string(),
          actionRequired: z.boolean(),
          errorMessage: z.string().optional(),
        }),
      });

      console.log('Page analysis:', pageAnalysis);

      // Handle different types of unsubscribe pages
      switch (pageAnalysis.pageType) {
        case 'already_unsubscribed':
          return {
            success: true,
            message: 'Already unsubscribed',
            details: pageAnalysis.description,
          };

        case 'confirmation':
          return {
            success: true,
            message: 'Unsubscribed successfully',
            details: pageAnalysis.description,
          };

        case 'error':
          return {
            success: false,
            message: 'Error on unsubscribe page',
            details: pageAnalysis.errorMessage || pageAnalysis.description,
          };

        case 'form':
        case 'button':
          // Try to complete the unsubscribe process
          await this.performUnsubscribeAction(page);

          // Wait for the action to complete
          await page.waitForTimeout(3000);

          // Check the result
          const result = await page.extract({
            instruction: 'Check if the unsubscribe was successful',
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
              confirmationText: z.string().optional(),
            }),
          });

          return {
            success: result.success,
            message: result.message,
            details: result.confirmationText,
          };

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

          return {
            success: genericResult.success,
            message: genericResult.message,
            details: 'Generic unsubscribe attempt',
          };
      }
    } catch (error) {
      console.error('Unsubscribe error:', error);
      return {
        success: false,
        message: 'Failed to process unsubscribe',
        details: error.message,
      };
    } finally {
      // Clean up the browser session
      if (stagehand) {
        try {
          await stagehand.close();
        } catch (closeError) {
          console.error('Error closing stagehand:', closeError);
        }
      }
    }
  }

  async performUnsubscribeAction(page) {
    try {
      // Try multiple common unsubscribe patterns
      const actions = [
        'click the unsubscribe button',
        'click the confirm unsubscribe button',
        'click the remove me button',
        'click the opt out button',
        'fill out and submit the unsubscribe form',
        'click any button that will unsubscribe me',
      ];

      for (const action of actions) {
        try {
          console.log(`Attempting action: ${action}`);
          await page.act(action);

          // Wait a bit to see if the action worked
          await page.waitForTimeout(2000);

          // Check if we've been redirected or if there's a success message
          const currentUrl = page.url();
          console.log(`Current URL after action: ${currentUrl}`);

          // If the action seems to have worked, break out of the loop
          const quickCheck = await page.extract({
            instruction:
              'Is there any indication that unsubscribe was successful or is in progress?',
            schema: z.object({
              actionWorked: z.boolean(),
              reason: z.string(),
            }),
          });

          if (quickCheck.actionWorked) {
            console.log(`Action succeeded: ${quickCheck.reason}`);
            break;
          }
        } catch (actionError) {
          console.log(`Action "${action}" failed:`, actionError.message);
          continue; // Try the next action
        }
      }
    } catch (error) {
      console.error('Error performing unsubscribe action:', error);
      throw error;
    }
  }
}

module.exports = new UnsubscribeService();
