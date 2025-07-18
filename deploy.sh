#!/bin/bash

# Email Sorting App Backend - Fly.io Deployment Script

echo "🚀 Starting deployment to Fly.io..."

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo "❌ Fly CLI is not installed. Please install it first:"
    echo "   curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if user is logged in
if ! fly auth whoami &> /dev/null; then
    echo "❌ You're not logged in to Fly.io. Please run:"
    echo "   fly auth login"
    exit 1
fi

# Set environment variables (you'll need to set these)
echo "📝 Setting environment variables..."

# Check if secrets are set
secrets_to_check=(
    "DATABASE_URL"
    "JWT_SECRET"
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
    "OPENAI_API_KEY"
)

for secret in "${secrets_to_check[@]}"; do
    if ! fly secrets list | grep -q "$secret"; then
        echo "⚠️  Secret $secret is not set. Please set it with:"
        echo "   fly secrets set $secret=your_value"
        echo ""
    fi
done

# Deploy the application
echo "🚀 Deploying application..."
fly deploy

# Check deployment status
if [ $? -eq 0 ]; then
    echo "✅ Deployment successful!"
    echo "🌐 Your app is available at: https://email-sorting-backend.fly.dev"
    echo "📊 Check status: fly status"
    echo "📝 View logs: fly logs"
else
    echo "❌ Deployment failed. Check the logs above for details."
    exit 1
fi