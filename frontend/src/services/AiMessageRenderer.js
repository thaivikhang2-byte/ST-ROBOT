import MarkdownIt from '../vendor/markdown-it/markdown-it.js';
import katex from '../vendor/katex/katex.js';

const MAX_REPLY_LENGTH = 12000;
const MAX_FORMULA_LENGTH = 2000;
const MAX_FORMULAS = 80;
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true, maxNesting: 30 });
const escape = markdown.utils.escapeHtml;

function escapedAt(source, position) {
    let count = 0;
    for (let index = position - 1; index >= 0 && source[index] === '\\'; index--) count++;
    return count % 2 === 1;
}

function findClosing(source, delimiter, start, maximum = source.length) {
    let found = source.indexOf(delimiter, start);
    while (found !== -1 && found < maximum) {
        if (!escapedAt(source, found)) return found;
        found = source.indexOf(delimiter, found + delimiter.length);
    }
    return -1;
}

// Fenced and inline code are handled by Markdown's code rules, before their
// contents can be interpreted as mathematics. Single dollars avoid prices.
markdown.inline.ruler.before('escape', 'ai_math', (state, silent) => {
    const start = state.pos;
    const source = state.src;
    let opening, closing, display = false;
    if (source.startsWith('$$', start)) { opening = closing = '$$'; display = true; }
    else if (source.startsWith('\\[', start)) { opening = '\\['; closing = '\\]'; display = true; }
    else if (source.startsWith('\\(', start)) { opening = '\\('; closing = '\\)'; }
    else if (source[start] === '$' && source[start + 1] !== '$' && !/\s/.test(source[start + 1] || ' ')) {
        opening = closing = '$';
    } else return false;
    const contentStart = start + opening.length;
    let end = findClosing(source, closing, contentStart, state.posMax);
    while (end !== -1 && opening === '$'
        && (/\s/.test(source[end - 1]) || /\d/.test(source[end + 1] || '') || source[end + 1] === '$')) {
        end = findClosing(source, closing, end + closing.length, state.posMax);
    }
    if (end === -1 || end === contentStart) return false;
    const content = source.slice(contentStart, end);
    if (opening === '$' && content.includes('\n')) return false;
    if (!silent) {
        const token = state.push('ai_math_inline', '', 0);
        token.content = content;
        token.meta = { display, original: source.slice(start, end + closing.length) };
    }
    state.pos = end + closing.length;
    return true;
});

markdown.block.ruler.before('fence', 'ai_math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const source = state.src;
    const opening = source.startsWith('$$', start) ? '$$' : source.startsWith('\\[', start) ? '\\[' : null;
    if (!opening) return false;
    const closing = opening === '$$' ? '$$' : '\\]';
    const maximum = state.eMarks[Math.min(endLine - 1, state.lineMax - 1)];
    const end = findClosing(source, closing, start + 2, maximum + 1);
    if (end === -1) return false;
    let finalLine = startLine;
    while (finalLine + 1 < endLine && state.eMarks[finalLine] < end + closing.length) finalLine++;
    if (source.slice(end + closing.length, state.eMarks[finalLine]).trim()) return false;
    if (silent) return true;
    const token = state.push('ai_math_block', '', 0);
    token.block = true;
    token.content = source.slice(start + opening.length, end).trim();
    token.meta = { display: true, original: source.slice(start, end + closing.length) };
    token.map = [startLine, finalLine + 1];
    state.line = finalLine + 1;
    return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

function renderFormula(token, environment, block) {
    const wrapper = block ? 'div' : 'span';
    const classes = 'ai-math' + (token.meta.display ? ' ai-math--display' : '');
    const fallback = () => `<${wrapper} class="${classes} ai-math-fallback">${escape(token.meta.original)}</${wrapper}>`;
    if (token.content.length > MAX_FORMULA_LENGTH || environment.mathRemaining-- <= 0) return fallback();
    try {
        const html = katex.renderToString(token.content, {
            displayMode: token.meta.display, output: 'htmlAndMathml',
            throwOnError: true, trust: false, strict: 'ignore',
            maxExpand: 300, maxSize: 10, macros: Object.create(null)
        });
        return `<${wrapper} class="${classes}">${html}</${wrapper}>`;
    } catch { return fallback(); }
}
markdown.renderer.rules.ai_math_inline = (tokens, index, _options, environment) => renderFormula(tokens[index], environment, false);
markdown.renderer.rules.ai_math_block = (tokens, index, _options, environment) => renderFormula(tokens[index], environment, true) + '\n';

// No remote images, executable raw HTML, or non-web URL schemes in AI replies.
markdown.renderer.rules.image = (tokens, index) => escape(tokens[index].content || '');
markdown.validateLink = url => {
    if (/[\u0000-\u001f\u007f]/.test(url)) return false;
    try { return ['http:', 'https:'].includes(new URL(url, 'https://thaivikhang2-byte.github.io/').protocol); }
    catch { return false; }
};
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.table_open = () => '<div class="ai-table-scroll"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';

export function renderAiMessageToHtml(text) {
    const value = typeof text === 'string' ? text : String(text ?? '');
    const html = markdown.render(value.slice(0, MAX_REPLY_LENGTH), { mathRemaining: MAX_FORMULAS });
    return html + (value.length > MAX_REPLY_LENGTH ? '<p class="ai-reply-truncated">Nội dung hiển thị đã được rút gọn.</p>' : '');
}

export function renderAiMessage(element, text) {
    element.classList.add('ai-rich-text');
    element.style.whiteSpace = 'normal';
    // Only HTML generated by Markdown(html:false) and KaTeX(trust:false).
    element.innerHTML = renderAiMessageToHtml(text);
    element.querySelectorAll('pre, code').forEach(code => {
        code.setAttribute('translate', 'no');
        code.classList.add('notranslate');
    });
    return element;
}
