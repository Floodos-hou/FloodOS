import puppeteer from '../apps/web/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log(`Using Chrome at: ${CHROME_PATH}`);

const SCREENSHOTS_DIR = 'docs/assets/screenshots';
const DOCS_DIR = 'docs/assets';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function captureScreen(username, password, expectedText, targetFilenames, tabToClick = null) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1050']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1050 });

  console.log(`[${username}] Navigating to http://localhost:3000 ...`);
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });

  // If already at login page, capture login if needed
  const uInput = await page.waitForSelector('#username');
  await uInput.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await uInput.type(username);

  const pInput = await page.waitForSelector('#password');
  await pInput.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await pInput.type(password);

  console.log(`[${username}] Clicking submit...`);
  const submitBtn = await page.waitForSelector('button[type="submit"]');
  await submitBtn.click();

  console.log(`[${username}] Waiting for workspace with text: "${expectedText}"...`);
  await page.waitForFunction((txt) => {
    return document.body.innerText.includes(txt);
  }, { timeout: 15000 }, expectedText);

  if (tabToClick) {
    console.log(`[${username}] Clicking tab: "${tabToClick}"...`);
    const tabBtn = await page.waitForFunction((tabText) => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.innerText.includes(tabText));
    }, { timeout: 5000 }, tabToClick);
    if (tabBtn) {
      await tabBtn.click();
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Wait 2.5s for map tiles and live data to settle
  await new Promise(r => setTimeout(r, 2500));

  for (const fn of targetFilenames) {
    const p1 = path.join(SCREENSHOTS_DIR, fn);
    const p2 = path.join(DOCS_DIR, fn);
    await page.screenshot({ path: p1, fullPage: false });
    fs.copyFileSync(p1, p2);
    console.log(`[${username}] Saved screenshot to: ${p1} and ${p2}`);
  }

  await browser.close();
}

async function captureLogin() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1050']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1050 });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#username');
  await new Promise(r => setTimeout(r, 1000));

  const p1 = path.join(SCREENSHOTS_DIR, 'floodos-login.png');
  const p2 = path.join(DOCS_DIR, 'floodos-login.png');
  await page.screenshot({ path: p1, fullPage: false });
  fs.copyFileSync(p1, p2);
  console.log(`Saved login screen to ${p1} and ${p2}`);

  await browser.close();
}

async function run() {
  console.log('=== CAPTURING UNIFIED LOGIN PAGE ===');
  await captureLogin();

  console.log('=== 1. CAPTURING DISPATCHER (Chị Hoa - Điều phối viên PCTT) ===');
  await captureScreen('dispatcher_hoa', '123456', 'Chị Hoa', ['floodos-dispatcher.png', 'floodos-overview.png']);

  console.log('=== 2. CAPTURING CITIZEN / REPORTER (Chị Lan - Người dân vùng ngập) ===');
  await captureScreen('reporter_lan', '123456', 'Chị Lan', ['floodos-reporter.png']);

  console.log('=== 3. CAPTURING FIELD TEAM (Anh Cường - Đội xung kích hiện trường) ===');
  await captureScreen('team_cuong', '123456', 'Anh Cường', ['floodos-field-team.png']);

  console.log('=== 4. CAPTURING RESOURCE MANAGER (Chị Giang - Quản lý nguồn lực & phương tiện) ===');
  await captureScreen('resource_giang', '123456', 'Giang', ['floodos-resource-manager.png']);

  console.log('=== 5. CAPTURING REPLAN RADAR TAB ===');
  await captureScreen('dispatcher_hoa', '123456', 'Chị Hoa', ['floodos-replan-radar.png'], 'Chi viện Sự cố');

  console.log('ALL DISTINCT ROLE WORKSPACE SCREENSHOTS CAPTURED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
