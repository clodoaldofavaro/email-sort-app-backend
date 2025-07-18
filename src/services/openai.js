const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const categorizeEmail = async (emailContent, categories) => {
  if (!categories || categories.length === 0) {
    return "Uncategorized";
  }

  const prompt = `
    Analyze this email and categorize it into one of the provided categories.
    
    Email Details:
    Subject: ${emailContent.subject || 'No subject'}
    From: ${emailContent.from || 'Unknown sender'}
    Content Preview: ${emailContent.body ? emailContent.body.substring(0, 1000) : 'No content'}
    
    Available Categories:
    ${categories.map(cat => `- ${cat.name}: ${cat.description}`).join('\n')}
    
    Rules:
    1. Return ONLY the category name that best matches
    2. If no category is a good fit, return "Uncategorized"
    3. Consider the email's purpose, content, and sender
    4. Be precise and consistent
    
    Category:`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 50,
      temperature: 0.1
    });

    const category = response.choices[0].message.content.trim();
    
    // Validate that the returned category exists
    const validCategory = categories.find(cat => 
      cat.name.toLowerCase() === category.toLowerCase()
    );
    
    return validCategory ? validCategory.name : "Uncategorized";
  } catch (error) {
    console.error('OpenAI categorization error:', error);
    return "Uncategorized";
  }
};

const summarizeEmail = async (emailContent) => {
  const prompt = `
    Create a concise 1-2 sentence summary of this email focusing on the main point and any required actions.
    
    Subject: ${emailContent.subject || 'No subject'}
    From: ${emailContent.from || 'Unknown sender'}
    Content: ${emailContent.body ? emailContent.body.substring(0, 2000) : 'No content available'}
    
    Summary:`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.1
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI summarization error:', error);
    return "Unable to generate summary - please check email content manually.";
  }
};

module.exports = { categorizeEmail, summarizeEmail };