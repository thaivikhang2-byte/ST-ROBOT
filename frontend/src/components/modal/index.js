import { getModalTemplate } from './template.js';
import { $ } from '../../utils/dom.js';

export class Modal {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render(id, title, body) {
        if (!this.container) return;
        this.container.innerHTML = getModalTemplate(id, title, body);
    }
    
    show(id) {
        const modalEl = $(`#${id}`);
        if (modalEl && window.bootstrap) {
            const modalInstance = new window.bootstrap.Modal(modalEl);
            modalInstance.show();
        }
    }
}
