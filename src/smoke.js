import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent("<title>Agent smoke test</title><h1>OK</h1>");
const title = await page.title();
const text = await page.locator("h1").innerText();
await browser.close();
if (title !== "Agent smoke test" || text !== "OK") process.exit(1);
console.log("Playwright Chromium smoke test passed.");
