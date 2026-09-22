'use strict';

/**
 * Route-level tests for POST /api/orders input validation.
 *
 * SPEC.md requires validation at the route boundary, before
 * orderService.createOrder is invoked, with one consistent 400 response
 * shape for every violation.
 *
 * These tests call the route's POST handler directly (extracted from the
 * router's stack) with hand-built req/res objects, in the same lightweight
 * mocking style as tests/middleware/auth.test.js, rather than supertest.
 * This sandboxed environment blocks opening local listening sockets
 * (confirmed: even a bare `http.createServer().listen()` throws EPERM here),
 * which supertest requires; calling the handler directly exercises the exact
 * same route logic without needing a live socket.
 */

jest.mock('../../src/services/orderService');
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { createOrder } = require('../../src/services/orderService');
const ordersRouter = require('../../src/routes/orders');

// Pull the POST "/" handler (the function registered after the
// `authenticate` middleware) straight out of the router's stack so it can
// be invoked in isolation, without going through auth or a real server.
function getPostHandler() {
  const layer = ordersRouter.stack.find(
    (l) => l.route && l.route.path === '/' && l.route.methods.post
  );
  const handlers = layer.route.stack.map((l) => l.handle);
  return handlers[handlers.length - 1];
}

const postHandler = getPostHandler();

function mockReqRes(body) {
  return {
    req: {
      body,
      user: { id: 'user-1', role: 'customer', customerTier: 'standard' },
    },
    res: {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    },
    next: jest.fn(),
  };
}

const validPayload = () => ({
  items: [{ productId: 'prod-1', quantity: 2 }],
  shippingState: 'CA',
});

describe('POST /api/orders - input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createOrder.mockResolvedValue({ id: 'order-1', status: 'pending' });
  });

  // ── items ────────────────────────────────────────────────────────────────

  describe('items', () => {
    it('rejects a request with missing items', async () => {
      const { items, ...rest } = validPayload();
      const { req, res, next } = mockReqRes(rest);

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('rejects a request with an empty items array', async () => {
      const { req, res, next } = mockReqRes({ ...validPayload(), items: [] });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('rejects an item without a productId', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        items: [{ quantity: 1 }],
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('rejects an item with an empty string productId', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        items: [{ productId: '', quantity: 1 }],
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });
  });

  // ── quantity ─────────────────────────────────────────────────────────────

  describe('quantity', () => {
    it('rejects an item with a missing quantity', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        items: [{ productId: 'prod-1' }],
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('rejects a zero quantity', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        items: [{ productId: 'prod-1', quantity: 0 }],
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('rejects a negative quantity', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        items: [{ productId: 'prod-1', quantity: -1 }],
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('rejects a non-integer quantity', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        items: [{ productId: 'prod-1', quantity: 1.5 }],
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });
  });

  // ── shippingState ────────────────────────────────────────────────────────

  describe('shippingState', () => {
    it('rejects an invalid shippingState', async () => {
      const { req, res, next } = mockReqRes({
        ...validPayload(),
        shippingState: 'California',
      });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createOrder).not.toHaveBeenCalled();
    });
  });

  // ── consistent error response shape ─────────────────────────────────────

  describe('consistent error response shape', () => {
    const invalidPayloads = [
      {
        name: 'missing items',
        body: (() => {
          const { items, ...rest } = validPayload();
          return rest;
        })(),
      },
      { name: 'empty items', body: { ...validPayload(), items: [] } },
      {
        name: 'item without productId',
        body: { ...validPayload(), items: [{ quantity: 1 }] },
      },
      {
        name: 'missing quantity',
        body: { ...validPayload(), items: [{ productId: 'prod-1' }] },
      },
      {
        name: 'zero quantity',
        body: { ...validPayload(), items: [{ productId: 'prod-1', quantity: 0 }] },
      },
      {
        name: 'negative quantity',
        body: { ...validPayload(), items: [{ productId: 'prod-1', quantity: -1 }] },
      },
      {
        name: 'non-integer quantity',
        body: { ...validPayload(), items: [{ productId: 'prod-1', quantity: 1.5 }] },
      },
      { name: 'invalid shippingState', body: { ...validPayload(), shippingState: 'XX1' } },
    ];

    it.each(invalidPayloads)('returns the agreed shape for: $name', async ({ body }) => {
      const { req, res, next } = mockReqRes(body);

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Validation failed',
        details: expect.any(Array),
      });

      const [{ details }] = res.json.mock.calls[0];
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((d) => typeof d === 'string')).toBe(true);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it('accumulates multiple simultaneous violations into a single response', async () => {
      const { req, res, next } = mockReqRes({ shippingState: 'California' });

      await postHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Validation failed',
        details: expect.any(Array),
      });

      expect(res.json.mock.calls[0][0].details.length).toBeGreaterThan(1);
      expect(createOrder).not.toHaveBeenCalled();
    });
  });

  // ── valid requests ───────────────────────────────────────────────────────

  describe('valid requests', () => {
    it('passes a valid payload through to the order service', async () => {
      const payload = validPayload();
      const { req, res, next } = mockReqRes(payload);

      await postHandler(req, res, next);

      expect(createOrder).toHaveBeenCalledWith(
        'user-1',
        'standard',
        payload.items,
        payload.shippingState
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        order: { id: 'order-1', status: 'pending' },
      });
    });
  });
});
