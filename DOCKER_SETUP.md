# Docker Setup for Email Sort App

This document explains how to run both the backend and frontend applications using Docker.

## Prerequisites

- Docker Desktop installed
- Docker Compose installed
- Environment variables configured

## Setup Instructions

1. **Environment Variables**

   Create a `.env` file in the backend directory with the following variables:
   ```bash
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
   OPENAI_API_KEY=your-openai-api-key
   BROWSERBASE_API_KEY=your-browserbase-api-key
   BROWSERBASE_PROJECT_ID=your-browserbase-project-id
   ```

2. **Start All Services**

   From the backend directory, run:
   ```bash
   docker-compose up
   ```

   This will start:
   - Backend API (http://localhost:8080)
   - Frontend (http://localhost:3000)
   - PostgreSQL database (localhost:5432)
   - Redis cache (localhost:6379)

3. **Optional: pgAdmin**

   To use pgAdmin for database management:
   ```bash
   docker-compose --profile tools up
   ```
   
   Access pgAdmin at http://localhost:5050
   - Email: admin@example.com
   - Password: admin

## Development Workflow

- **Backend changes**: The backend volume mounts `./src` so changes are reflected immediately
- **Frontend changes**: The frontend volume mounts `src` and `public` directories for hot reload
- **Database changes**: Modify `src/database/schema.sql` and restart the postgres container

## Common Commands

```bash
# Start all services
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f [service-name]

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v

# Rebuild images
docker-compose build

# Access container shell
docker-compose exec [service-name] sh
```

## Troubleshooting

1. **Port conflicts**: Ensure ports 3000, 8080, 5432, and 6379 are available
2. **Database connection issues**: Wait for postgres health check to pass
3. **Frontend can't connect to backend**: Verify REACT_APP_API_URL is set correctly
4. **Permission issues**: Check volume mount permissions