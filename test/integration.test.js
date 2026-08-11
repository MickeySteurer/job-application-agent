import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractForm, fillField } from '../src/browser_helpers.js';

test('extracts a mock ATS form safely and groups radios', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = pathToFileURL(path.resolve('mock/application.html')).href;
    await page.goto(url);
    const form = await extractForm(page);

    const auth = form.controls.find(f => f.key === 'radio|are you legally authorized to work in the united states');
    assert.ok(auth, 'authorization radio question should be grouped');
    assert.equal(auth.options.length, 2);

    const disability = form.controls.find(f => /disability status/.test(f.key));
    assert.ok(disability?.sensitive, 'disability should be flagged sensitive');

    const salary = form.controls.find(f => f.key === 'text|desired salary');
    assert.ok(salary);
    await fillField(page, salary, '85000');
    assert.equal(await page.locator('#salary').inputValue(), '85000');

    await fillField(page, auth, 'Yes');
    assert.equal(await page.locator('input[name="authorized"][value="Yes"]').isChecked(), true);
  } finally {
    await browser.close();
  }
});
