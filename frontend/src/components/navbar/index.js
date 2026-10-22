import { getNavbarTemplate } from './template.js';
import { $, $$ } from '../../utils/dom.js';

export class Navbar {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getNavbarTemplate();
        this.setActiveLink();
        this.attachEvents();
    }

    setActiveLink() {
        const currentPath = window.location.pathname;
        const links = $$('.navbar-nav .nav-link');
        links.forEach(link => {
            // Very simple path matching
            const path = link.getAttribute('data-path');
            if (currentPath.endsWith(path) || (currentPath === '/' && path === '/')) {
                link.classList.add('active');
            } else if (currentPath.includes('index.html') && path === '/') {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    attachEvents() {
        const themeBtn = $('#themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                // We dispatch a custom event so ThemeController can handle it
                document.dispatchEvent(new CustomEvent('toggle-theme'));
            });
        }
    }
}
