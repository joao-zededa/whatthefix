const request = require('supertest');
require('dotenv').config();

describe('Auth routes basic', () => {
  let server;
  beforeAll(() => {
    jest.resetModules();
    const { app } = require('../server');
    server = app;
  });

  test('GET /auth/me unauthenticated', async () => {
    const res = await request(server).get('/auth/me');
    expect(res.statusCode).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('POST /auth/validate without token returns 400', async () => {
    const res = await request(server).post('/auth/validate');
    expect(res.statusCode).toBe(400);
  });
});


