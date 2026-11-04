import { getFooterTemplate } from './template.js?v=copy-v4';
import { $ } from '../../utils/dom.js';

export class Footer {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getFooterTemplate();
    }
}
