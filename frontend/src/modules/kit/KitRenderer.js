import { $ } from '../../utils/dom.js';
import { ROUTES } from '../../constants/routes.js';

export class KitRenderer {
    renderKitList(kits, containerId) {
        const container = $(containerId);
        if (!container) return;

        let html = '';
        kits.forEach(kit => {
            let tagsHtml = kit.tags.map(t => `<li><span class="tag">${t}</span></li>`).join('');
            html += `
              <div class="kit-item" data-name="${kit.name}" data-type="${kit.type}">
                <article class="card kit-card card--interactive">
                  <img class="card-media" src="${kit.image}" alt="${kit.displayTitle}" loading="lazy">
                  <div class="card-body">
                    <h2>${kit.displayTitle}</h2>
                    <p>${kit.displayDesc}</p>
                    <ul class="tag-list" aria-label="Linh kiện nổi bật">${tagsHtml}</ul>
                    <div class="card-actions">
                      <button type="button" class="btn btn--primary btn-show-kit-detail" data-id="${kit.id}">Thông số chi tiết</button>
                      <a href="${ROUTES.DANG_KY}" class="btn">Đăng ký lớp</a>
                    </div>
                  </div>
                </article>
              </div>
            `;
        });
        container.innerHTML = html;
    }
}
