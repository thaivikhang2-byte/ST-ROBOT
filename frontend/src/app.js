import { Navbar } from './components/navbar/index.js?v=copy-v4';
import { Footer } from './components/footer/index.js?v=copy-v4';
import { Chatbox } from './components/chatbox/index.js?v=catalog-report-v12';
import { BackToTop } from './components/backtotop/index.js';
import { ThemeService } from './services/ThemeService.js';
import { Router } from './router/Router.js';
import { ROUTES } from './constants/routes.js?v=copy-v4';

// Module Controllers
import { HomeController } from './modules/home/HomeController.js?v=lesson-code-v5';
import { KitController } from './modules/kit/KitController.js?v=copy-v4';
import { QuizController } from './modules/quiz/QuizController.js?v=quiz-priority-v10';
import { AssessmentController } from './modules/assessment/AssessmentController.js?v=copy-v4';
import { GioiThieuController } from './modules/gioithieu/GioiThieuController.js';
import { DangKyController } from './modules/dangky/DangKyController.js';
import { CatalogController } from './modules/hoclieu/CatalogController.js?v=lesson-code-v5';

class App {
    constructor() {
        this.themeService = new ThemeService();
        
        this.navbar = new Navbar('#navbar-container');
        this.footer = new Footer('#footer-container');
        this.chatbox = new Chatbox('#chatbox-container');
        this.backToTop = new BackToTop('#backtotop-container');
        
        this.router = new Router([
            { path: ROUTES.HOME, controller: HomeController },
            { path: ROUTES.KIT, controller: KitController },
            { path: ROUTES.GIOI_THIEU, controller: GioiThieuController },
            { path: ROUTES.QUIZ, controller: QuizController },
            { path: ROUTES.ASSESSMENT, controller: AssessmentController },
            { path: ROUTES.DANG_KY, controller: DangKyController },
            { path: ROUTES.HOC_LIEU, controller: CatalogController }
        ]);
    }

    init() {
        this.themeService.init();
        this.navbar.render();
        this.footer.render();
        this.chatbox.render();
        this.backToTop.render();
        
        this.router.init();
        
        // Handle scroll progress
        window.addEventListener('scroll', () => {
            let scrollTop = document.documentElement.scrollTop;
            let scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            let progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
            let progressBar = document.getElementById("scrollProgress");
            if (progressBar) {
                progressBar.style.width = progress + "%";
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
