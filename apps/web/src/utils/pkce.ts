// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/** RFC 7636: the code_verifier is generated and kept in the browser; only the S256 challenge is sent out. */

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlSafe(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Trình duyệt không hỗ trợ Web Crypto (cần HTTPS hoặc localhost) nên không thể đăng nhập PKCE an toàn.');
  }
  const verifier = randomUrlSafe(48); // 64 chars, within the 43–128 range
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}
