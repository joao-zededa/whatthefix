const request = require('supertest');
require('dotenv').config();

describe('API Route Protection', () => {
  let server;
  let agent;
  
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    const { app } = require('../server');
    server = app;
    agent = request.agent(server);
  });

  describe('Unauthenticated Access', () => {
    test('GET /api/search/commits - returns 401', async () => {
      const res = await agent.get('/api/search/commits?query=test');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/search/tags - returns 401', async () => {
      const res = await agent.get('/api/search/tags?query=test');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/tags - returns 401', async () => {
      const res = await agent.get('/api/tags');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/commits/:sha - returns 401', async () => {
      const res = await agent.get('/api/commits/abc123');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/commits/:sha/tags - returns 401', async () => {
      const res = await agent.get('/api/commits/abc123/tags');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/commits/:sha/backports - returns 401', async () => {
      const res = await agent.get('/api/commits/abc123/backports');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/cache/status - returns 401', async () => {
      const res = await agent.get('/api/cache/status');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('Authenticated Access', () => {
    beforeEach(async () => {
      // Simulate login with test endpoint
      await agent.post('/test/login').send({ 
        roles: ['user'],
        groups: ['Users']
      });
    });

    test('GET /api/cache/status - returns 200', async () => {
      const res = await agent.get('/api/cache/status');
      expect(res.statusCode).toBe(200);
    });

    test('GET /api/search/commits - returns 400 without query', async () => {
      const res = await agent.get('/api/search/commits');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Query parameter is required');
    });

    // Note: These will return 500 without actual GitHub token/repo setup
    // but the important part is they're not returning 401
    test('GET /api/search/commits with query - is authenticated', async () => {
      const res = await agent.get('/api/search/commits?query=fix');
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('Auth Endpoints - Public Access', () => {
    test('GET /auth/me - is accessible without authentication', async () => {
      const res = await request(server).get('/auth/me');
      expect(res.statusCode).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });

    test('GET /login.html - is publicly accessible', async () => {
      const res = await request(server).get('/login.html');
      expect(res.statusCode).toBe(200);
    });
  });
});




