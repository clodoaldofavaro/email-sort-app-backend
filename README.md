# AI Email Sorting App - Backend

A Node.js backend for an AI-powered email sorting application that automatically categorizes and summarizes emails using OpenAI, with Google OAuth integration and automated unsubscribe functionality.

## Features

- **Google OAuth Integration**: Secure login with Google accounts
- **Multi-Account Support**: Connect multiple Gmail accounts
- **AI Email Categorization**: Automatically sort emails into custom categories using OpenAI
- **AI Email Summarization**: Generate concise summaries of emails
- **Automated Unsubscribe**: AI-powered unsubscribe from unwanted emails
- **Email Archiving**: Automatically archive processed emails in Gmail
- **Bulk Actions**: Delete or unsubscribe from multiple emails at once
- **RESTful API**: Full CRUD operations for categories and emails

## Tech Stack

- **Node.js** with Express.js
- **PostgreSQL** database
- **Google APIs** (Gmail, OAuth2)
- **OpenAI API** for AI features
- **Playwright** for browser automation
- **JWT** for authentication
- **Redis** (optional) for job queuing

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- Google Cloud Console project with Gmail API enabled
- OpenAI API key

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd email-sort-app-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your actual values:
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: From Google Cloud Console
   - `OPENAI_API_KEY`: From OpenAI platform
   - `JWT_SECRET`: A secure random string

4. **Database Setup**
   ```bash
   # Create database (adjust for your setup)
   createdb email_sorting_db
   
   # Run migrations
   npm run db:migrate
   ```

5. **Start the server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## Google OAuth Setup

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select existing one

2. **Enable Gmail API**
   - Go to APIs & Services > Library
   - Search for "Gmail API" and enable it

3. **Create OAuth2 Credentials**
   - Go to APIs & Services > Credentials
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Set application type to "Web application"
   - Add authorized redirect URIs:
     - `http://localhost:3000/callback` (for frontend)
     - `https://your-domain.com/callback` (for production)

4. **Configure Scopes**
   Required scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`

5. **Add Test Users**
   - Go to OAuth consent screen
   - Add test users (including your Gmail address)
   - For production, you'll need to verify the app

## API Endpoints

### Authentication
- `GET /api/auth/google` - Get Google OAuth URL
- `POST /api/auth/google/callback` - Handle OAuth callback
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/refresh` - Refresh access token

### Categories
- `GET /api/categories` - List user's categories
- `POST /api/categories` - Create new category
- `GET /api/categories/:id` - Get category details
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category

### Emails
- `GET /api/emails/category/:categoryId` - Get emails in category
- `GET /api/emails/:id` - Get email details
- `DELETE /api/emails/bulk` - Bulk delete emails
- `POST /api/emails/bulk/unsubscribe` - Bulk unsubscribe from emails
- `PUT /api/emails/:id/category` - Move email to category
- `GET /api/emails/stats` - Get email statistics

### Accounts
- `GET /api/accounts` - List connected accounts
- `POST /api/accounts/google` - Connect new Gmail account
- `DELETE /api/accounts/:id` - Disconnect account
- `POST /api/accounts/:id/process` - Trigger email processing
- `GET /api/accounts/:id/stats` - Get account statistics

## Usage Flow

1. **User Authentication**
   - User clicks "Sign in with Google"
   - App redirects to Google OAuth
   - User grants permissions
   - User is redirected back with auth code
   - App exchanges code for tokens

2. **Category Management**
   - User creates custom categories with descriptions
   - Categories are used by AI to sort emails

3. **Email Processing**
   - App fetches unread emails from Gmail
   - AI categorizes emails based on content and user categories
   - AI generates summaries for each email
   - Emails are archived in Gmail after processing

4. **Email Management**
   - Users can view emails by category
   - Bulk actions available (delete, unsubscribe)
   - AI-powered unsubscribe automatically finds and clicks unsubscribe links

## Advanced Features

### AI-Powered Unsubscribe
The app can automatically unsubscribe from emails by:
1. Extracting unsubscribe links from email headers and body
2. Using Playwright to navigate to unsubscribe pages
3. Automatically clicking unsubscribe buttons
4. Handling various unsubscribe form patterns

### Multi-Account Support
Users can connect multiple Gmail accounts:
- Each account is processed independently
- Emails are tagged with source account
- Separate statistics per account

### Scheduled Processing
- Emails are processed every 10 minutes in production
- Manual processing can be triggered per account
- Only processes emails from the last 7 days

## Development

### Running Tests
```bash
npm test
```

### Database Migrations
```bash
npm run db:migrate
```

### Development Server
```bash
npm run dev
```

## Production Deployment

### Fly.io Deployment

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login to Fly.io**
   ```bash
   fly auth login
   ```

3. **Create and Configure App**
   ```bash
   # Create app (if not exists)
   fly apps create email-sorting-backend
   
   # Set up PostgreSQL database
   fly postgres create --name email-sorting-db
   fly postgres attach email-sorting-db
   ```

4. **Set Environment Variables**
   ```bash
   fly secrets set JWT_SECRET=your_secure_jwt_secret
   fly secrets set GOOGLE_CLIENT_ID=your_google_client_id
   fly secrets set GOOGLE_CLIENT_SECRET=your_google_client_secret
   fly secrets set OPENAI_API_KEY=your_openai_api_key
   fly secrets set FRONTEND_URL=https://your-frontend-domain.com
   
   # Optional: Browserbase for advanced unsubscribe
   fly secrets set BROWSERBASE_API_KEY=your_browserbase_api_key
   fly secrets set BROWSERBASE_PROJECT_ID=your_browserbase_project_id
   ```

5. **Deploy**
   ```bash
   # Use the deployment script
   ./deploy.sh
   
   # Or deploy manually
   fly deploy
   ```

6. **Run Database Migrations**
   ```bash
   fly ssh console
   npm run db:migrate
   exit
   ```

### Manual Deployment

1. **Environment Variables**
   - Use production database URL
   - Use production Google OAuth URLs
   - Set `NODE_ENV=production`
   - Use secure JWT secret

2. **Database**
   - Ensure PostgreSQL is running
   - Run migrations in production

3. **SSL/HTTPS**
   - Use HTTPS in production
   - Update Google OAuth redirect URIs

4. **Docker Deployment**
   ```bash
   docker build -t email-sorting-backend .
   docker run -p 8080:8080 --env-file .env email-sorting-backend
   ```

## Security Considerations

- JWT tokens expire after 7 days
- Rate limiting on API endpoints
- Input validation on all endpoints
- SQL injection protection with parameterized queries
- CORS configuration for frontend domains
- Helmet.js for security headers

## Troubleshooting

### Common Issues

1. **"Authentication failed"**
   - Check Google OAuth credentials
   - Ensure redirect URIs match exactly
   - Verify user is added as test user

2. **"Database connection error"**
   - Check PostgreSQL is running
   - Verify DATABASE_URL is correct
   - Ensure database exists

3. **"OpenAI API error"**
   - Check API key is valid
   - Verify you have sufficient credits
   - Check rate limits

### Debug Mode
Set `NODE_ENV=development` for detailed error messages.

## License

MIT License

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Run tests
5. Submit pull request

## Support

For issues and questions, please create an issue in the GitHub repository.