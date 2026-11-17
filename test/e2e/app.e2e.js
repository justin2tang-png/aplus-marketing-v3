'use strict';

/*
 * End-to-end test (Linux, xvfb) using Playwright's Electron driver.
 * Scenario A: mock provider -> generate -> edit -> save -> edit in library -> restart -> content persists.
 * Scenario B: pi-cli provider wired to test/fixtures/fake-pi.js (direct spawn, no shell) -> generate.
 * This is a SIMULATION on Linux; it does not prove Windows behaviour or real Pi/GPT generation.
 */

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
// Screenshots go to gitignored test-results/ so running the suite never dirties committed docs/evidence/.
const evidenceDir = process.env.E2E_SCREENSHOT_DIR || path.join(projectRoot, 'test-results', 'e2e-screenshots');
const topic = '首次置业 First home buyer tips & KiwiSaver';

const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   - ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL - ${name}: ${error.message}`);
    throw error;
  }
}

async function launchApp(userData) {
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu'],
    cwd: projectRoot,
    env: { ...process.env, APLUS_USER_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForSelector('#generate');
  return { app, page };
}

function screenshot(page, name) {
  return page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

async function waitToast(page, text) {
  await page.locator('#toast').filter({ hasText: text }).waitFor({ timeout: 10000 });
}

async function scenarioMock() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-e2e-a-'));
  let session;
  try {
    session = await launchApp(userData);
    let { app, page } = session;
    const editedTitleSuffix = ' (edited)';
    const bodyEdit = '\n\n[Edited in review] Book a free chat with our adviser.';
    const libraryEdit = '\n[Edited again in library]';
    let title;
    let body;

    await step('A1 app opens on Create screen', async () => {
      await screenshot(page, '01-create-empty.png');
    });
    await step('A2 automatic backup created on first start', async () => {
      const files = fs.readdirSync(path.join(userData, 'backups')).filter((n) => n.endsWith('.db'));
      assert.ok(files.length >= 1, 'no backup file');
    });
    await step('A3 switch provider to mock in Settings and save', async () => {
      await page.locator('[data-tab="settings"]').click();
      await page.locator('#ai-provider').selectOption('mock');
      await page.locator('#save-settings').click();
      await waitToast(page, 'Settings saved');
      await screenshot(page, '04-settings.png');
    });
    await step('A4 enter topic and generate copy', async () => {
      await page.locator('[data-tab="create"]').click();
      await page.locator('#topic').fill(topic);
      await page.locator('#generate').click();
      await page.locator('#draft').waitFor({ state: 'visible' });
      const generatedBody = await page.locator('#draft-body').inputValue();
      assert.ok(generatedBody.includes(topic), 'generated body does not mention topic');
    });
    await step('A5 review/edit title and body, save to library', async () => {
      title = (await page.locator('#draft-title').inputValue()) + editedTitleSuffix;
      body = (await page.locator('#draft-body').inputValue()) + bodyEdit;
      await page.locator('#draft-title').fill(title);
      await page.locator('#draft-body').fill(body);
      await screenshot(page, '02-generated.png');
      await page.locator('#save-draft').click();
      await waitToast(page, '已保存');
    });
    await step('A6 library lists the saved item; open and edit it (status approved)', async () => {
      await page.locator('[data-tab="library"]').click();
      await page.locator('.library-item').filter({ hasText: title }).click();
      body += libraryEdit;
      await page.locator('#edit-body').fill(body);
      await page.locator('#edit-status').selectOption('approved');
      await page.locator('#save-edit').click();
      await waitToast(page, '已保存');
      await screenshot(page, '03-library.png');
    });
    await step('A7 quit and relaunch the app with the same userData', async () => {
      await app.close();
      session = await launchApp(userData);
      ({ app, page } = session);
    });
    await step('A8 content persists after restart (title, body, status)', async () => {
      await page.locator('[data-tab="library"]').click();
      await page.locator('.library-item').filter({ hasText: title }).click();
      assert.equal(await page.locator('#edit-title').inputValue(), title);
      assert.equal(await page.locator('#edit-body').inputValue(), body);
      assert.equal(await page.locator('#edit-status').inputValue(), 'approved');
      await screenshot(page, '05-after-restart-library.png');
    });
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function scenarioFakePi() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-e2e-b-'));
  let session;
  try {
    session = await launchApp(userData);
    const { page } = session;
    await step('B1 configure pi-cli provider with fake Pi CLI path (direct, stdin)', async () => {
      await page.locator('[data-tab="settings"]').click();
      await page.locator('#ai-provider').selectOption('pi-cli');
      await page.locator('#pi-path').fill(path.join(projectRoot, 'test', 'fixtures', 'fake-pi.js'));
      await page.locator('#pi-launch-mode').selectOption('direct');
      await page.locator('#pi-prompt-via').selectOption('stdin');
      await page.locator('#save-settings').click();
      await waitToast(page, 'Settings saved');
    });
    await step('B2 generate through spawned fake Pi; prompt (incl. Chinese) delivered via stdin', async () => {
      await page.locator('[data-tab="create"]').click();
      await page.locator('#topic').fill(topic);
      await page.locator('#generate').click();
      await page.locator('#draft').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#draft-title').inputValue(), 'Fake Pi');
      const echoed = await page.locator('#draft-body').inputValue();
      assert.ok(echoed.includes(topic), 'fake Pi did not receive the topic via stdin');
      assert.ok(/not financial advice/i.test(echoed), 'compliance line missing from prompt');
      await screenshot(page, '06-pi-cli-fake-generated.png');
    });
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  console.log('E2E (Linux/xvfb, simulated providers)');
  try {
    await scenarioMock();
    await scenarioFakePi();
  } catch (error) {
    process.exitCode = 1;
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`E2E steps: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
