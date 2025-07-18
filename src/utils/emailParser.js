const cheerio = require('cheerio');

const extractEmailContent = (payload) => {
  let body = '';
  let attachments = [];
  
  const extractFromPart = (part) => {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    
    if (part.mimeType === 'text/html' && part.body && part.body.data) {
      const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
      const $ = cheerio.load(html);
      
      // Remove script and style elements
      $('script, style').remove();
      
      // Extract text content
      return $.text().replace(/\s+/g, ' ').trim();
    }
    
    return '';
  };
  
  if (payload.body && payload.body.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  } else if (payload.parts) {
    // Handle multipart messages
    for (const part of payload.parts) {
      if (part.mimeType === 'multipart/alternative' && part.parts) {
        // Handle nested multipart
        for (const nestedPart of part.parts) {
          const content = extractFromPart(nestedPart);
          if (content && content.length > body.length) {
            body = content;
          }
        }
      } else {
        const content = extractFromPart(part);
        if (content) {
          body += content + '\n';
        }
      }
      
      // Track attachments
      if (part.filename) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body?.size || 0
        });
      }
    }
  }
  
  // Clean HTML if present
  if (body.includes('<')) {
    const $ = cheerio.load(body);
    $('script, style').remove();
    body = $.text().replace(/\s+/g, ' ').trim();
  }
  
  return {
    body: body.substring(0, 10000), // Limit body size
    attachments
  };
};

const extractUnsubscribeLinks = (body, headers) => {
  const links = [];
  
  // Check List-Unsubscribe header
  const listUnsubscribe = headers.find(h => h.name === 'List-Unsubscribe')?.value;
  if (listUnsubscribe) {
    // Extract URLs from header
    const urlMatches = listUnsubscribe.match(/<(https?:\/\/[^>]+)>/g);
    if (urlMatches) {
      urlMatches.forEach(match => {
        const url = match.slice(1, -1); // Remove < >
        links.push(url);
      });
    }
  }
  
  // Check List-Unsubscribe-Post header
  const listUnsubscribePost = headers.find(h => h.name === 'List-Unsubscribe-Post')?.value;
  
  // Extract from email body
  const bodyPatterns = [
    /href=['"](https?:\/\/[^'"]*unsubscribe[^'"]*)['"]/gi,
    /href=['"](https?:\/\/[^'"]*opt-out[^'"]*)['"]/gi,
    /href=['"](https?:\/\/[^'"]*remove[^'"]*)['"]/gi,
    /href=['"](https?:\/\/[^'"]*preference[^'"]*)['"]/gi,
    /(https?:\/\/[^\s]*unsubscribe[^\s]*)/gi,
    /(https?:\/\/[^\s]*opt-out[^\s]*)/gi
  ];
  
  for (const pattern of bodyPatterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const url = match[1] || match[0];
      if (url && !links.includes(url)) {
        links.push(url);
      }
    }
  }
  
  // Return the most likely unsubscribe link
  if (links.length > 0) {
    // Prefer List-Unsubscribe header links
    const headerLink = links.find(link => listUnsubscribe && listUnsubscribe.includes(link));
    if (headerLink) return headerLink;
    
    // Prefer links with 'unsubscribe' in them
    const unsubLink = links.find(link => link.toLowerCase().includes('unsubscribe'));
    if (unsubLink) return unsubLink;
    
    // Return first link
    return links[0];
  }
  
  return null;
};

module.exports = {
  extractEmailContent,
  extractUnsubscribeLinks
};