import { $ } from '../../utils/dom.js';

export class DangKyController {
    init() {
        const form = $('#registerForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                $('#submissionSuccessMsg').style.display = 'block';
            });
        }
    }
}
