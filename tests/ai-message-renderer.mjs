import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { renderAiMessageToHtml as render } from '../frontend/src/services/AiMessageRenderer.js';

test('renders the reported LED formula as a fraction with subscripts', () => {
    const html = render('$$I = \\frac{V_s - V_f}{R}$$');
    assert.match(html, /class="katex"/);
    assert.match(html, /<mfrac>/);
    assert.match(html, /<msub>/);
    assert.doesNotMatch(html, /ai-math-fallback/);
});

test('supports inline, display and multiline delimiters with Vietnamese and units', () => {
    for (const text of ['$R = 330\\,\\Omega$', '\\(x_1 = 2^3\\)', '\\[I = \\frac{U}{R}\\]', '$$\nI=\\frac{5-2}{330}\n$$']) {
        const html = render(text);
        assert.match(html, /class="katex"/);
        assert.doesNotMatch(html, /ai-math-fallback/);
    }
    assert.match(render('Điện trở **phù hợp**:\n- Tính dòng điện.\n- Kiểm tra đơn vị.'), /Điện trở <strong>phù hợp<\/strong>/);
    assert.match(render('| Giá trị | Đơn vị |\n| --- | --- |\n| 330 | Ω |'), /<table>/);
});

test('leaves code, escaped dollar signs and ordinary prices literal', () => {
    const source = '```python\ncount += presses\nformula = "$$I=\\frac{U}{R}$$"\n```\nDùng `\\frac{U}{R}` và `$x_1$`.';
    const html = render(source);
    assert.match(html, /count \+= presses/);
    assert.match(html, /\\frac\{U\}\{R\}/);
    assert.match(html, /<code>\$x_1\$<\/code>/);
    assert.doesNotMatch(html, /class="katex"/);
    for (const price of ['Giá $5 và $10.', 'Giá từ $5-$10.', 'Giá \\$5.']) assert.doesNotMatch(render(price), /class="katex"/);
});

test('falls back safely for malformed TeX and keeps later valid mathematics', () => {
    const html = render('$\\notARealMathCommand{x}$ rồi $x_1=2$.');
    assert.match(html, /ai-math-fallback/);
    assert.match(html, /\\notARealMathCommand/);
    assert.match(html, /class="katex"/);
    assert.match(render('Công thức chưa đóng: $$I=3'), /\$\$I=3/);
});

test('escapes raw HTML, blocks executable links and never embeds remote images', () => {
    const html = render('<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) ![ảnh](https://example.invalid/track.png)');
    assert.doesNotMatch(html, /<(?:script|img|iframe|svg)\b/i);
    assert.doesNotMatch(html, /href="javascript:/i);
    assert.match(html, /&lt;script&gt;/);
    const safe = render('[Tài liệu](https://example.org/lesson)');
    assert.match(safe, /rel="noopener noreferrer"/);
    assert.match(safe, /target="_blank"/);
});

test('untrusted TeX cannot embed HTML, images or dangerous links', () => {
    for (const tex of ['\\href{javascript:alert(1)}{x}', '\\htmlClass{attack}{x}', '\\includegraphics{https://example.invalid/track.png}']) {
        const html = render('$$'+tex+'$$');
        assert.doesNotMatch(html, /<(?:script|img|iframe)\b/i);
        assert.doesNotMatch(html, /href="javascript:/i);
        assert.doesNotMatch(html, /class="attack"/);
    }
});

test('bounds macro expansion, formula size and reply length', () => {
    const started = performance.now();
    const loop = render('$$\\def\\loop{\\loop}\\loop$$');
    assert.match(loop, /ai-math-fallback/);
    assert.ok(performance.now()-started < 2000, 'recursive macro stops within the bounded expansion budget');
    assert.match(render('$$'+ 'x+'.repeat(1200)+'1$$'), /ai-math-fallback/);
    const huge = render('A'.repeat(20000));
    assert.match(huge, /Nội dung hiển thị đã được rút gọn/);
    assert.ok(huge.length < 13000);
    const bounded = render('$$\\rule{1000000em}{1000000em}$$');
    assert.doesNotMatch(bounded, /style="[^"]*1000000em/);
});
