import { PathResolver } from '../../core/PathResolver.js';

export const iconHref = (name) => `${PathResolver.asset('icons.svg')}#${name}`;

/** Inline SVG from the shared sprite. Decorative by default; pass a label for standalone meaning. */
export const icon = (name, label = '') => label
    ? `<svg class="icon" role="img" aria-label="${label}" focusable="false"><use href="${iconHref(name)}"></use></svg>`
    : `<svg class="icon" aria-hidden="true" focusable="false"><use href="${iconHref(name)}"></use></svg>`;
