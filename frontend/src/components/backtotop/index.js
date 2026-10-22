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

        window.addEventListener('scroll', () => {
            const scrollTop = document.documentElement.scrollTop;
            if (scrollTop > 400) {
                btn.style.display = 'block';
            } else {
                btn.style.display = 'none';
            }
        });

        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
}
