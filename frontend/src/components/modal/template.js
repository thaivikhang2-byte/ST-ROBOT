export const getModalTemplate = (id, title, body) => `
  <div class="modal fade" id="${id}" tabindex="-1">
    <div class="modal-dialog modal-lg modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title fw-bold">${title}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">${body}</div>
      </div>
    </div>
  </div>
`;
