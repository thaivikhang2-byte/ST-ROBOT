const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const root = path.resolve(__dirname, '../..');
(async () => {
  const directory = path.join(root, 'backups/phase12-pre-selfstudy-rollback');
  const archive = JSON.parse(await fs.readFile(path.join(directory, 'frontend-manifest.json')));
  assert.equal(archive.files.length, 105);
  const html = await fs.readFile(path.join(directory, 'historical-source.html'), 'utf8');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const before = path.join(directory, 'pre-rollback-screenshots'); await fs.mkdir(before, { recursive: true });
    await page.goto('http://localhost:8080/course.learning.html');
    await page.locator('#courseSelect option').first().waitFor({ state: 'attached' });
    await page.screenshot({ path: path.join(before, 'desktop-light.png') });
    await page.locator('#themeToggleBtn').click();
    await page.screenshot({ path: path.join(before, 'desktop-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(before, 'mobile-dark.png') });
    const reference = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await reference.route('**/*', route => route.abort());
    await reference.setContent(html, { waitUntil: 'domcontentloaded' });
    await reference.screenshot({ path: path.join(before, 'historical-reference.png') });
    const css = await reference.evaluate(() => {
      const prefix = 'body.learning-page .legacy-workspace';
      function scope(rules) {
        return [...rules].map(rule => {
          if (rule.type === CSSRule.STYLE_RULE) {
            const selectors = rule.selectorText.split(',').map(selector => {
              const s = selector.trim().replace(/\bbody\b/g, prefix).replace(/\bheader\b/g, '.ws-head');
              return s.includes(prefix) ? s : prefix + ' ' + s;
            });
            if (!selectors.every(s => s.startsWith(prefix))) throw Error('Unscoped historical CSS');
            return selectors.join(',\n') + ' {' + rule.style.cssText + '}';
          }
          if (rule.type === CSSRule.MEDIA_RULE) return '@media ' + rule.conditionText + ' {\n' + scope(rule.cssRules) + '\n}';
          if (rule.type === CSSRule.KEYFRAMES_RULE) return rule.cssText;
          throw Error('Unsupported historical CSS rule');
        }).join('\n');
      }
      return [...document.querySelectorAll('style')].slice(0, 3).map(style => {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(style.textContent.replace(/\bbounce\b/g, 'strobot-legacy-bounce')); return scope(sheet.cssRules);
      }).join('\n');
    });
    assert.match(css, /width: 260px/); assert.match(css, /width: 300px/); assert.match(css, /#0f172a|rgb\(15, 23, 42\)/);
    await fs.writeFile(path.join(directory, 'historical-scoped.css'), '/* Derived verbatim declarations from 0d3f61e; selectors scoped to Self-Study; navbar excluded. */\n' + css);
    console.log('PASS: historical CSS declarations extracted/scoped; pre-rollback desktop/mobile/reference screenshots saved.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
