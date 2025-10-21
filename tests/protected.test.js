const request = require('supertest');
require('dotenv').config();

describe('Protected API', () => {
  let server;
  let agent;
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    const { app } = require('../server');
    server = app;
    agent = request.agent(server);
  });

  test('Rejects unauthenticated', async () => {
    const res = await agent.get('/api/protected');
    expect(res.statusCode).toBe(401);
  });

  test('Allows authenticated with admin role', async () => {
    await agent.post('/test/login').send({ roles: ['admin'] });
    const res = await agent.get('/api/protected');
    expect(res.statusCode).toBe(200);
    expect(res.body.user.roles).toContain('admin');
  });
});



