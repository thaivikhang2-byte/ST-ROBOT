import { getItem, setItem } from '../utils/storage.js';
import { STORAGE_KEYS } from '../constants/storage.js';
import { THEMES } from '../constants/theme.js';

export class ThemeService {
    constructor() {
        this.currentTheme = getItem(STORAGE_KEYS.THEME) || THEMES.LIGHT;
    }

    init() {
        if (this.currentTheme === THEMES.DARK) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        
        document.addEventListener('toggle-theme', () => this.toggleTheme());
    }

    toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        this.currentTheme = isDark ? THEMES.DARK : THEMES.LIGHT;
        setItem(STORAGE_KEYS.THEME, this.currentTheme);
    }
}
