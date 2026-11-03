// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import puppeteer from '../apps/web/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log(`Using Chrome at: ${CHROME_PATH}`);

const SCRATCH_DIR = 'scratch';
const ASSETS_DIR = 'docs/assets/screenshots';

if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

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

async function logout(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#username', { timeout: 10000 });
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

function copyToAssets(src, destFilename) {
  const dest = path.join(ASSETS_DIR, destFilename);
  fs.copyFileSync(src, dest);
  console.log(`Copied ${src} -> ${dest}`);
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
  await new Promise(r => setTimeout(r, 1000));
  const s1 = path.join(SCRATCH_DIR, '01_login_screen.png');
  await page.screenshot({ path: s1, fullPage: true });
  console.log(`Saved ${s1}`);
  copyToAssets(s1, 'floodos-login.png');

  // 2. Dispatcher Workspace (dispatcher_hoa)
  console.log('--- 2. Capturing Dispatcher Workspace (dispatcher_hoa) ---');
  await login(page, 'dispatcher_hoa');
  await page.waitForFunction(() => document.body.innerText.includes('Chị Hoa') || document.body.innerText.includes('Điều phối viên'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2500));
  const s2 = path.join(SCRATCH_DIR, '02_dispatcher_workspace.png');
  await page.screenshot({ path: s2, fullPage: true });
  console.log(`Saved ${s2}`);
  copyToAssets(s2, 'floodos-dispatcher.png');

  // 3. Tactical Map Fullscreen Tab
  console.log('--- 3. Capturing Tactical Map Tab ---');
  await clickTab(page, 'Bản đồ Tác chiến');
  await new Promise(r => setTimeout(r, 3000));
  const s3 = path.join(SCRATCH_DIR, '03_tactical_map_fullscreen.png');
  await page.screenshot({ path: s3, fullPage: true });
  console.log(`Saved ${s3}`);
  copyToAssets(s3, 'floodos-overview.png');

  // 4. Radar & Rescue Replan Tab
  console.log('--- 4. Capturing Radar & Replan Tab ---');
  await clickTab(page, 'Chi viện');
  await new Promise(r => setTimeout(r, 2000));
  const s4 = path.join(SCRATCH_DIR, '04_radar_replan.png');
  await page.screenshot({ path: s4, fullPage: true });
  console.log(`Saved ${s4}`);
  copyToAssets(s4, 'floodos-replan-radar.png');

  // 5. BPMN SOP Workflow Tab
  console.log('--- 5. Capturing BPMN Flowable Workflow Tab ---');
  await clickTab(page, 'Quy trình SOP');
  await new Promise(r => setTimeout(r, 2000));
  const s5 = path.join(SCRATCH_DIR, '05_bpmn_workflow.png');
  await page.screenshot({ path: s5, fullPage: true });
  console.log(`Saved ${s5}`);

  // 6. Reporter Workspace (reporter_lan)
  console.log('--- 6. Capturing Reporter Workspace (reporter_lan) ---');
  await logout(page);
  await login(page, 'reporter_lan');
  await page.waitForFunction(() => document.body.innerText.includes('Chị Lan') || document.body.innerText.includes('Người báo tin'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  const s6 = path.join(SCRATCH_DIR, '06_reporter_workspace.png');
  await page.screenshot({ path: s6, fullPage: true });
  console.log(`Saved ${s6}`);
  copyToAssets(s6, 'floodos-reporter.png');

  // 6b. Reporter Mobile Responsive (360x740)
  console.log('--- 6b. Capturing Reporter Mobile Responsive (360x740) ---');
  await page.setViewport({ width: 360, height: 740, isMobile: true, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 1500));
  const s6m = path.join(SCRATCH_DIR, '09_reporter_mobile_360.png');
  await page.screenshot({ path: s6m, fullPage: true });
  console.log(`Saved ${s6m}`);

  // Reset desktop viewport
  await page.setViewport({ width: 1680, height: 1050, isMobile: false, deviceScaleFactor: 1 });

  // 7. Field Team Workspace (team_cuong)
  console.log('--- 7. Capturing Field Team Workspace (team_cuong) ---');
  await logout(page);
  await login(page, 'team_cuong');
  await page.waitForFunction(() => document.body.innerText.includes('Anh Cường') || document.body.innerText.includes('Đội') || document.body.innerText.includes('tác chiến'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  const s7 = path.join(SCRATCH_DIR, '07_field_team_workspace.png');
  await page.screenshot({ path: s7, fullPage: true });
  console.log(`Saved ${s7}`);
  copyToAssets(s7, 'floodos-field-team.png');

  // 7b. Field Team Mobile Responsive (360x740)
  console.log('--- 7b. Capturing Field Team Mobile Responsive (360x740) ---');
  await page.setViewport({ width: 360, height: 740, isMobile: true, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 1500));
  const s7m = path.join(SCRATCH_DIR, '10_field_team_mobile_360.png');
  await page.screenshot({ path: s7m, fullPage: true });
  console.log(`Saved ${s7m}`);

  // Reset desktop viewport
  await page.setViewport({ width: 1680, height: 1050, isMobile: false, deviceScaleFactor: 1 });

  // 8. Resource Manager Workspace (resource_giang)
  console.log('--- 8. Capturing Resource Manager Workspace (resource_giang) ---');
  await logout(page);
  await login(page, 'resource_giang');
  await page.waitForFunction(() => document.body.innerText.includes('Giang') || document.body.innerText.includes('Nguồn lực') || document.body.innerText.includes('Hạ Tầng'), { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  const s8 = path.join(SCRATCH_DIR, '08_resource_manager_workspace.png');
  await page.screenshot({ path: s8, fullPage: true });
  console.log(`Saved ${s8}`);
  copyToAssets(s8, 'floodos-resource-manager.png');

  await browser.close();
  console.log('\nALL WORKSPACES, TABS AND MOBILE RESPONSIVE VIEWS CAPTURED AND COPIED TO DOCS!');
}

run().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
