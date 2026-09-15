// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import puppeteer from '../apps/web/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log(`Using browser: ${CHROME_PATH}`);

async function testUser(username, expectedText, screenshotName) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[${username} BROWSER ERROR]`, msg.text());
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });

  await page.waitForSelector('#username');
  await page.waitForSelector('#password');

  // Type credentials
  await page.$eval('#username', el => { el.value = ''; });
  await page.type('#username', username);

  await page.$eval('#password', el => { el.value = ''; });
  await page.type('#password', '123456');

  console.log(`[${username}] Submitting login...`);
  const submitBtn = await page.waitForSelector('button[type="submit"]');
  await submitBtn.click();

  await page.waitForFunction((txt) => {
    return document.body.innerText.includes(txt);
  }, { timeout: 15000 }, expectedText);

  console.log(`[${username}] Authenticated! Found: "${expectedText}"`);

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `scratch/${screenshotName}`, fullPage: true });
  console.log(`[${username}] Screenshot saved to scratch/${screenshotName}`);

  await browser.close();
}

async function run() {
  console.log('--- Testing DISPATCHER (dispatcher_hoa) ---');
  await testUser('dispatcher_hoa', 'Chị Hoa', 'login_dispatcher_success.png');

  console.log('--- Testing REPORTER (reporter_lan) ---');
  await testUser('reporter_lan', 'Chị Lan', 'login_reporter_success.png');

  console.log('ALL USERS LOGGED IN SUCCESSFULLY ON REAL DOCKER STACK!');
}

run().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
