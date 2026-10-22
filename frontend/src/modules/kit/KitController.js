import { KitService } from './KitService.js';
import { KitRenderer } from './KitRenderer.js';
import { $, $$ } from '../../utils/dom.js';
import { Modal } from '../../components/modal/index.js';

export class KitController {
    constructor() {
        this.service = new KitService();
        this.renderer = new KitRenderer();
        this.modal = new Modal('#modal-container');
        this.kits = [];
        this.activeFilter = 'all';
    }

    async init() {
        this.kits = await this.service.getKits();
        this.renderer.renderKitList(this.kits, '#kitList');
        this.attachEvents();
    }

    attachEvents() {
        const searchInput = $('#kitSearch');
        if (searchInput) {
            searchInput.addEventListener('keyup', () => this.applyGridFilter());
        }

        const filterTabs = $$('.filter-tab-btn');
        filterTabs.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.activeFilter = e.target.getAttribute('data-filter');
                filterTabs.forEach(b => {
                    b.classList.remove('btn-primary');
                    b.classList.add('btn-outline-primary');
                });
                e.target.classList.remove('btn-outline-primary');
                e.target.classList.add('btn-primary');
                this.applyGridFilter();
            });
        });

        // Use event delegation for dynamic buttons
        const kitList = $('#kitList');
        if (kitList) {
            kitList.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-show-kit-detail')) {
                    const kitId = e.target.getAttribute('data-id');
                    this.showKitDetail(kitId);
                }
            });
        }
    }

    applyGridFilter() {
        const searchInput = $('#kitSearch');
        const searchKeyword = searchInput ? searchInput.value.toLowerCase() : '';
        const cards = $$('.kit-item');
        
        cards.forEach(card => {
            const itemText = card.getAttribute('data-name');
            const itemType = card.getAttribute('data-type');
            
            const isNameMatched = itemText.includes(searchKeyword);
            const isTypeMatched = this.activeFilter === 'all' || itemType === this.activeFilter;
            
            card.style.display = (isNameMatched && isTypeMatched) ? 'block' : 'none';
        });
    }

    showKitDetail(kitId) {
        const kit = this.kits.find(k => k.id === kitId);
        if (kit) {
            this.modal.render('kitDetailsModal', kit.title, kit.body);
            this.modal.show('kitDetailsModal');
        }
    }
}
