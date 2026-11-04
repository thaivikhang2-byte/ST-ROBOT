import { renderCourses } from '../../components/courses/CourseCard.js';
import { courses } from '../../data/courses.js?v=lesson-code-v5';

/** Accessible hero carousel: auto-rotates, pauses on hover/focus, honours prefers-reduced-motion. */
export function initCarousel(root) {
    const slides = [...root.querySelectorAll('.hc-slide')];
    if (slides.length < 2) return;
    const dots = root.querySelector('.hc-dots');
    const toggle = root.querySelector('[data-hc="toggle"]');
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let index = 0, timer = null, userPaused = !!reduced;

    slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.type = 'button'; dot.className = 'hc-dot'; dot.setAttribute('aria-label', `Slide ${i + 1}`);
        dot.addEventListener('click', () => show(i));
        dots.append(dot);
    });
    const show = (next) => {
        index = (next + slides.length) % slides.length;
        slides.forEach((s, i) => {
            s.classList.toggle('is-active', i === index);
            s.querySelectorAll('a,button').forEach((el) => { el.tabIndex = i === index ? 0 : -1; });
            s.setAttribute('aria-hidden', String(i !== index));
        });
        [...dots.children].forEach((d, i) => { if (i === index) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    };
    const stop = () => { clearInterval(timer); timer = null; };
    const start = () => { stop(); if (!userPaused && !root.contains(document.activeElement) && !root.matches(':hover')) timer = setInterval(() => show(index + 1), 6000); };
    const paintToggle = () => {
        toggle.setAttribute('aria-pressed', String(userPaused));
        toggle.setAttribute('aria-label', userPaused ? 'Tiếp tục tự chuyển slide' : 'Tạm dừng tự chuyển slide');
        const glyph = toggle.querySelector('use');
        if (glyph) glyph.setAttribute('href', glyph.getAttribute('href').replace(/#[^#]*$/, userPaused ? '#play' : '#stop'));
    };
    root.querySelector('[data-hc="prev"]').addEventListener('click', () => show(index - 1));
    root.querySelector('[data-hc="next"]').addEventListener('click', () => show(index + 1));
    root.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); show(index + (event.key === 'ArrowRight' ? 1 : -1));
        }
    });
    toggle.addEventListener('click', () => {
        userPaused = !userPaused;
        paintToggle();
        start();
    });
    root.addEventListener('mouseenter', stop); root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop); root.addEventListener('focusout', start);
    paintToggle();
    show(0); start();
}

export class HomeController {
    init() {
        const carousel = document.getElementById('heroCarousel');
        if (carousel) initCarousel(carousel);
        const host = document.getElementById('featuredCourses');
        if (host) renderCourses(host, courses.slice(0, 3));
    }
}
