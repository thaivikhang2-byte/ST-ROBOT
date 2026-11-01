import { getNavbarTemplate } from './template.js';
import { $, $$ } from '../../utils/dom.js';
import { icon } from '../ui/icon.js';

/** Pure: does a page URL path correspond to the current location? Handles directory roots and base paths. */
export function isActivePath(currentPath, linkPath) {
    const normalize = (path) => path.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
    return normalize(currentPath) === normalize(linkPath);
}

export class Navbar {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getNavbarTemplate();
        this.setActiveLink();
        this.attachEvents();
        this.syncThemeButton();
    }

    setActiveLink() {
        for (const link of $$('.navbar a[data-path]')) {
            if (isActivePath(window.location.pathname, link.getAttribute('data-path'))) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
    }

    syncThemeButton() {
        const button = $('#themeToggleBtn');
        if (!button) return;
        const dark = document.body.classList.contains('dark-mode');
        button.setAttribute('aria-pressed', String(dark));
        button.setAttribute('aria-label', dark ? 'Bật chế độ sáng' : 'Bật chế độ tối');
        button.innerHTML = icon(dark ? 'sun' : 'moon');
    }

    attachEvents() {
        $('#themeToggleBtn')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('toggle-theme')));
        document.addEventListener('theme-changed', () => this.syncThemeButton());

        const toggle = $('#navToggle');
        const menu = $('#mainNavbar');
        if (!toggle || !menu) return;
        const setOpen = (open) => {
            menu.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
            toggle.innerHTML = icon(open ? 'x' : 'menu');
        };
        toggle.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));
        menu.addEventListener('click', (event) => { if (event.target.closest('a')) setOpen(false); });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && menu.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
        });
    }
}
