const request = require('supertest');
const app = require('../../server');
const db = require('../../config/database');

describe('Authentication Integration Tests', () => {
    beforeAll(async () => {
        // Clean up test data
        await db.query("DELETE FROM users WHERE email LIKE '%test%'");
    });

    afterAll(async () => {
        await db.end();
    });

    describe('GET /api/auth/google', () => {
        it('should return Google OAuth URL', async () => {
            const response = await request(app).get('/api/auth/google').expect(200);

            expect(response.body.url).toContain('accounts.google.com');
            expect(response.body.url).toContain('oauth2');
        });
    });

    describe('POST /api/auth/google/callback', () => {
        it('should reject invalid authorization code', async () => {
            const response = await request(app)
                .post('/api/auth/google/callback')
                .send({ code: 'invalid-code' })
                .expect(400);

            expect(response.body.error).toBe('Authentication failed');
        });

        it('should require authorization code', async () => {
            const response = await request(app).post('/api/auth/google/callback').send({}).expect(400);

            expect(response.body.error).toBe('Authorization code required');
        });
    });

    describe('GET /api/auth/me', () => {
        it('should require authentication', async () => {
            const response = await request(app).get('/api/auth/me').expect(401);

            expect(response.body.error).toBe('Access token required');
        });
    });
});
