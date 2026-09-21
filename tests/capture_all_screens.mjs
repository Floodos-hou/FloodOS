// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import puppeteer from '../apps/web/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log(`Using Chrome at: ${CHROME_PATH}`);

async function login(page, username, password = '123456') {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.waitForSelector('#password', { timeout: 10000 });

  await page.$eval('#username', el => { el.value = ''; });
  await page.type('#username', username);

  await page.$eval('#password', el => { el.value = ''; });
  await page.type('#password', password);

  const submitBtn = await page.waitForSelector('button[type="submit"]');
  await submitBtn.click();
}

async function clickTab(page, text) {
  await page.waitForFunction((t) => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.some(b => b.innerText.includes(t));
  }, { timeout: 10000 }, text);

  await page.evaluate((t) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText.includes(t));
    if (btn) btn.click();
  }, text);
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1680,1050']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });

  // 1. Capture Login Screen
  console.log('--- 1. Capturing Login Screen ---');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#username');
  await page.screenshot({ path: 'scratch/01_login_screen.png', fullPage: true });
  console.log('Saved scratch/01_login_screen.png');

  // 2. Dispatcher Workspace & Tabs (dispatcher_hoa)
  console.log('--- 2. Capturing Dispatcher Workspace (dispatcher_hoa) ---');
  await login(page, 'dispatcher_hoa');
  await page.waitForFunction(() => document.body.innerText.includes('Chị Hoa'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'scratch/02_dispatcher_workspace.png', fullPage: true });
  console.log('Saved scratch/02_dispatcher_workspace.png');

  // 3. Tactical Map Fullscreen Tab
  console.log('--- 3. Capturing Tactical Map Tab ---');
  await clickTab(page, 'Bản đồ Tác chiến');
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: 'scratch/03_tactical_map_fullscreen.png', fullPage: true });
  console.log('Saved scratch/03_tactical_map_fullscreen.png');

  // 4. Radar & Rescue Replan Tab
  console.log('--- 4. Capturing Radar & Replan Tab ---');
  await clickTab(page, 'Chi viện');
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'scratch/04_radar_replan.png', fullPage: true });
  console.log('Saved scratch/04_radar_replan.png');

  // 5. BPMN SOP Workflow Tab
  console.log('--- 5. Capturing BPMN Flowable Workflow Tab ---');
  await clickTab(page, 'Quy trình SOP');
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'scratch/05_bpmn_workflow.png', fullPage: true });
  console.log('Saved scratch/05_bpmn_workflow.png');

  // 6. Reporter Workspace (reporter_lan)
  console.log('--- 6. Capturing Reporter Workspace (reporter_lan) ---');
  await page.evaluate(() => localStorage.clear());
  await login(page, 'reporter_lan');
  await page.waitForFunction(() => document.body.innerText.includes('Chị Lan'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'scratch/06_reporter_workspace.png', fullPage: true });
  console.log('Saved scratch/06_reporter_workspace.png');

  // 7. Field Team Workspace (team_cuong)
  console.log('--- 7. Capturing Field Team Workspace (team_cuong) ---');
  await page.evaluate(() => localStorage.clear());
  await login(page, 'team_cuong');
  await page.waitForFunction(() => document.body.innerText.includes('Cường') || document.body.innerText.includes('Đội') || document.body.innerText.includes('tác chiến'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'scratch/07_field_team_workspace.png', fullPage: true });
  console.log('Saved scratch/07_field_team_workspace.png');

  // 8. Resource Manager Workspace (resource_giang)
  console.log('--- 8. Capturing Resource Manager Workspace (resource_giang) ---');
  await page.evaluate(() => localStorage.clear());
  await login(page, 'resource_giang');
  await page.waitForFunction(() => document.body.innerText.includes('Giang') || document.body.innerText.includes('Nguồn lực') || document.body.innerText.includes('Hạ Tầng'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'scratch/08_resource_manager_workspace.png', fullPage: true });
  console.log('Saved scratch/08_resource_manager_workspace.png');

  await browser.close();
  console.log('ALL WORKSPACES & FUNCTIONAL TABS CAPTURED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
