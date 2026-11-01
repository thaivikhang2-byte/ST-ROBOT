export const getModalTemplate = (id, title, body) => `
  <dialog class="kit-dialog" id="${id}" aria-labelledby="${id}-title">
    <div class="kit-dialog-head">
      <h2 id="${id}-title"></h2>
      <button type="button" class="btn btn--ghost btn--icon" data-close-dialog aria-label="Đóng thông số chi tiết">×</button>
    </div>
    <div class="kit-dialog-body">${body}</div>
  </dialog>
`;
