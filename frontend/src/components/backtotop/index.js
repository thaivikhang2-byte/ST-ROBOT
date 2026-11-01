import { getBackToTopTemplate } from './template.js';
import { $ } from '../../utils/dom.js';

export class BackToTop {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getBackToTopTemplate();
        this.attachEvents();
    }

    attachEvents() {
        const btn = $('#backToTopBtn');
        if (!btn) return;

        const updateVisibility = () => {
            btn.classList.toggle('is-visible', window.scrollY > 400);
        };
        window.addEventListener('scroll', updateVisibility, { passive: true });
        updateVisibility();

        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
}
