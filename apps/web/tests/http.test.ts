// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, requestJson } from '../src/services/http.ts';

const withFetch = async (response: Response | Error, run: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; }
};

test('HTTP errors preserve status, API code, message and details', async () => {
  await withFetch(new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Không có quyền', reason: 'role' }), { status: 403 }), async () => {
    await assert.rejects(requestJson('/api/v1', '/reports', {}, 'token'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.message, 'Không có quyền');
      assert.equal(error.details.reason, 'role');
      return true;
    });
  });
});

test('non-JSON HTTP errors fall back to the response status text', async () => {
  await withFetch(new Response('upstream unavailable', { status: 502, statusText: 'Bad Gateway' }), async () => {
    await assert.rejects(requestJson('/api/v1', '/reports'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.equal(error.code, 'HTTP_502');
      return true;
    });
  });
});

test('network exceptions propagate instead of looking like successful responses', async () => {
  const networkError = new TypeError('Failed to fetch');
  await withFetch(networkError, async () => {
    await assert.rejects(requestJson('/api/v1', '/reports'), networkError);
  });
});

test('successful responses return parsed JSON', async () => {
  await withFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }), async () => {
    assert.deepEqual(await requestJson('/api/v1', '/health'), { ok: true });
  });
});
