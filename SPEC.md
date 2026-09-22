# SPEC: Input-Validation Hardening for `POST /api/orders`

## Problem

`POST /api/orders` ([src/routes/orders.js:87-110](src/routes/orders.js#L87-L110)) currently validates only that
`items` is a non-empty array. Everything else — item shape, `productId`, `quantity`, `shippingState` — flows
straight into `orderService.createOrder` unvalidated. Bad values (missing `productId`, a zero/negative/non-integer
`quantity`, a malformed `shippingState`) either produce confusing downstream errors from the service/model layer
or silently do the wrong thing (e.g. `taxCalculator` falls back to a default rate for an invalid state code
instead of rejecting it).

This spec hardens the route boundary so invalid input is rejected with a consistent `400` response **before**
`createOrder` is ever invoked, without changing the service or model layers.

## Requirements

- Validate the request at the route boundary before calling `createOrder`.
- `items` must be a non-empty array.
- Every item must contain a non-empty `productId`.
- Every item's `quantity` must be a positive integer.
- `shippingState` must be a two-letter state code.
- Invalid input must return HTTP `400`.
- Validation errors must use one consistent response shape.
- Invalid input must not reach the order service.
- Preserve the existing routes → services → models structure.
- Keep the change small and limited to this feature.

## 1. Files to Change

| File | Change |
|---|---|
| `src/routes/orders.js` | **Only production file touched.** Add a `validateOrderPayload(body)` helper and call it in the `POST /` handler before `createOrder(...)` is invoked. |
| `tests/routes/orders.test.js` | **New file.** Route-level tests (via `supertest`) proving invalid payloads are rejected with `400` and never reach `orderService.createOrder`, and that valid payloads still pass through. |

**Explicitly out of scope — do not modify:**
- `src/services/orderService.js` and `src/models/*` — business logic and persistence are unchanged; validation happens strictly before the service boundary.
- `tests/services/orderService.test.js` — must continue to pass unmodified, proving the service layer wasn't touched.
- `src/middleware/auth.js`, `src/middleware/errorHandler.js` — auth and global error handling are unaffected.

### Rationale for where validation lives

The codebase has no validation library (no Joi/Zod/express-validator in `package.json`) and no `validators/`
directory. Existing routes (`src/routes/users.js`, `src/routes/products.js`, `src/routes/search.js`) all validate
inline in the handler with `res.status(400).json({ error: "..." })`. To keep the change small and consistent with
existing conventions, the new validation is a plain helper function colocated in `src/routes/orders.js`, not a new
module or middleware layer.

## 2. Ordered Implementation Steps

1. In `src/routes/orders.js`, add a pure function `validateOrderPayload(body)` that returns `{ valid: boolean, errors: string[] }`, checking (accumulating **all** violations, not failing fast on the first one):
   - `items` is an array with `length >= 1`.
   - Every element of `items` is an object with a non-empty string `productId`.
   - Every element's `quantity` is a positive integer (`Number.isInteger(quantity) && quantity > 0`).
   - If `shippingState` is provided, it matches `/^[A-Za-z]{2}$/`. (If omitted, the existing `shippingState || "CA"` default in the handler is preserved — omission is not itself an error.)
2. In the `POST /` handler, call `validateOrderPayload(req.body)` immediately after destructuring `{ items, shippingState }`, before the existing `items` array check and before `createOrder(...)`.
3. If `!valid`, respond immediately with:
   ```json
   { "error": "Validation failed", "details": ["<message 1>", "<message 2>", "..."] }
   ```
   status `400`, and `return` — do not fall through to `createOrder`.
4. Remove or fold the old standalone `items` check ([orders.js:91-93](src/routes/orders.js#L91-L93)) into the new validator so there is exactly one validation path and one response shape for this endpoint (avoids two different `400` shapes for overlapping cases).
5. Leave the existing `createOrder(...)` call and its downstream error-to-status mapping (`"not found"` / `"Insufficient stock"` → `400`) unchanged — those handle *service-layer* errors (e.g. product doesn't exist), which is a distinct concern from request-shape validation.
6. Create `tests/routes/orders.test.js`:
   - Use `supertest` against the exported app (`src/index.js`).
   - Mock `../../src/middleware/auth` so `authenticate()` returns a middleware that sets `req.user = { id, role: "customer", customerTier: "standard" }` and calls `next()` — this isolates the test from real JWT/DB lookups.
   - Mock `../../src/services/orderService` so `createOrder` is a `jest.fn()` — assert it is/isn't called per case.
   - Cover the cases listed in the Definition of Done below.
7. Run `npm test`; fix any regressions before considering the change complete.

## 3. Testable Definition of Done

All of the following must hold:

- [ ] `POST /api/orders` with `items` missing, `items: []`, or `items` not an array → `400`, response shape `{ error, details }`, `orderService.createOrder` **not called**.
- [ ] `POST /api/orders` with an item missing `productId`, or `productId: ""` → `400`, `createOrder` **not called**.
- [ ] `POST /api/orders` with an item's `quantity` being `0`, negative, a non-integer float (e.g. `1.5`), or non-numeric (e.g. `"3"`, `null`) → `400`, `createOrder` **not called**.
- [ ] `POST /api/orders` with `shippingState` that is not exactly two alphabetic characters (e.g. `"California"`, `"C1"`, `""`) → `400`, `createOrder` **not called**.
- [ ] `POST /api/orders` with multiple simultaneous violations → single `400` response whose `details` array lists more than one message (proves violations are accumulated, not fail-fast).
- [ ] `POST /api/orders` with a fully valid payload (non-empty `items`, valid `productId`s, positive integer `quantity`s, omitted or valid `shippingState`) → passes through to `createOrder`, existing `201` behavior is unchanged.
- [ ] Every validation-failure response across all the above cases has the **same JSON shape**: top-level `error` (string) and `details` (array of strings) keys — no case returns a differently-shaped `400` body.
- [ ] `tests/services/orderService.test.js` still passes **unmodified**, confirming the service layer was not touched.
- [ ] No file under `src/services/` or `src/models/` shows a diff.

## 4. Verification Steps

1. Run the full test suite and confirm all suites pass, including the new `tests/routes/orders.test.js`:
   ```
   npm test
   ```
2. Confirm the production-code diff is limited to the intended file:
   ```
   git diff --stat src/
   ```
   Expected: only `src/routes/orders.js` listed.
3. (Optional, manual/live check) Start the dev server and confirm the live response shape for an invalid payload:
   ```
   npm run dev
   curl -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <valid-token>" \
     -d '{"items": [{"productId": "", "quantity": -1}], "shippingState": "California"}'
   ```
   Expected: HTTP `400` with body `{ "error": "Validation failed", "details": [...] }`.

## 5. Test Command

```
npm test
```
