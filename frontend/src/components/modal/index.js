import { getModalTemplate } from './template.js';
import { $ } from '../../utils/dom.js';

export class Modal {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render(id, title, body) {
        if (!this.container) return;
        this.container.innerHTML = getModalTemplate(id, title, body);
        const modalEl = this.container.querySelector('dialog');
        modalEl.querySelector('h2').textContent = title;
        modalEl.querySelector('[data-close-dialog]').addEventListener('click', () => modalEl.close());
        modalEl.addEventListener('click', event => {
            if (event.target !== modalEl) return;
            const box = modalEl.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modalEl.close();
        });
    }
    
    show(id) {
        const modalEl = $(`#${id}`);
        if (modalEl) modalEl.showModal();
    }
}
