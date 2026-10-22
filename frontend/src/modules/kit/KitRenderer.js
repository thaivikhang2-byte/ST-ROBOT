import { $ } from '../../utils/dom.js';
import { ROUTES } from '../../constants/routes.js';

export class KitRenderer {
    renderKitList(kits, containerId) {
        const container = $(containerId);
        if (!container) return;

        let html = '';
        kits.forEach(kit => {
            let tagsHtml = kit.tags.map(t => `<span class="tag">${t}</span>`).join(' ');
            html += `
              <div class="col-md-3 kit-item" data-name="${kit.name}" data-type="${kit.type}">
                <div class="kit-card">
                  <img src="${kit.image}" alt="${kit.id}">
                  <div class="card-body">
                    <h4 class="fw-bold">${kit.displayTitle}</h4>
                    <p>${kit.displayDesc}</p>
                    ${tagsHtml}<br>
                    <button class="btn btn-primary mt-3 btn-show-kit-detail" data-id="${kit.id}">Thông số chi tiết</button>
                    <a href="${ROUTES.DANG_KY}" class="btn btn-outline-success mt-3">Đăng ký lớp</a>
                  </div>
                </div>
              </div>
            `;
        });
        container.innerHTML = html;
    }
}
