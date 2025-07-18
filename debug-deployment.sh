#!/bin/bash

# Debug deployment script
echo "🔍 Debugging Fly.io deployment..."

# Check if app exists
echo "📋 Checking app status..."
fly status -a email-sort-app-backend

echo ""
echo "📝 Recent logs:"
fly logs -a email-sort-app-backend --limit 50

echo ""
echo "🔐 Checking secrets:"
fly secrets list -a email-sort-app-backend

echo ""
echo "💾 Checking database connection:"
fly postgres connect -a email-sorting-db || echo "❌ Database connection failed"

echo ""
echo "🏥 Testing health endpoint:"
curl -f https://email-sort-app-backend.fly.dev/health || echo "❌ Health check failed"

echo ""
echo "🐛 Debug info:"
echo "App URL: https://email-sort-app-backend.fly.dev"
echo "Health URL: https://email-sort-app-backend.fly.dev/health"
echo "API Base: https://email-sort-app-backend.fly.dev/api"