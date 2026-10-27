// Render dist/total-fuze-patient-guide.html to a print-ready PDF (US Letter).
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const src = path.join(__dirname, 'dist', 'total-fuze-patient-guide.html');
  const out = path.join(__dirname, 'dist', 'total-fuze-patient-guide.pdf');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + src, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  await browser.close();
  console.log('wrote ' + out);
})();
