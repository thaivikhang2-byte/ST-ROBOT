import { learnerSync } from './services/LearnerSyncService.js';
import { warmAccountConnection } from './services/AccountConnectionWarmup.js';
import { Navbar } from './components/navbar/index.js?v=product-workspace-v1';
import { Footer } from './components/footer/index.js?v=copy-v4';
import { Chatbox } from './components/chatbox/index.js?v=account-data-perf-v1';
import { BackToTop } from './components/backtotop/index.js';
import { ThemeService } from './services/ThemeService.js';
import { Router } from './router/Router.js?v=page-perf-v1';
import { ROUTES } from './constants/routes.js?v=account-sync-v1';

class App {
    constructor() {
        this.themeService = new ThemeService();
        
        this.navbar = new Navbar('#navbar-container');
        this.footer = new Footer('#footer-container');
        this.chatbox = new Chatbox('#chatbox-container');
        this.backToTop = new BackToTop('#backtotop-container');
        
        this.router = new Router([
            { path: ROUTES.HOME, loadController: () => import('./modules/home/HomeController.js?v=lesson-code-v5').then(module => module.HomeController) },
            { path: ROUTES.KIT, loadController: () => import('./modules/kit/KitController.js?v=copy-v4').then(module => module.KitController) },
            { path: ROUTES.GIOI_THIEU, loadController: () => import('./modules/gioithieu/GioiThieuController.js').then(module => module.GioiThieuController) },
            { path: ROUTES.QUIZ, loadController: () => import('./modules/quiz/QuizController.js?v=account-sync-v1').then(module => module.QuizController) },
            { path: ROUTES.ASSESSMENT, loadController: () => import('./modules/assessment/AssessmentController.js?v=copy-v4').then(module => module.AssessmentController) },
            { path: ROUTES.DANG_KY, loadController: () => import('./modules/dangky/DangKyController.js?v=guided-learning-v15').then(module => module.DangKyController) },
            { path: ROUTES.HOC_LIEU, loadController: () => import('./modules/hoclieu/CatalogController.js?v=lesson-code-v5').then(module => module.CatalogController) }
        ]);
    }

    async init() {
        this.themeService.init();
        this.navbar.render();
        this.footer.render();
        this.chatbox.render();
        this.backToTop.render();
        warmAccountConnection();
        
        // Public pages can render while a sleeping backend restores the session.
        // Quiz history must wait for the correct account; the lesson page waits
        // independently before it loads its journal and editor projects.
        if (window.location.pathname.endsWith('/quiz.html')) await learnerSync.ready();
        else void learnerSync.ready();
        this.router.init();
        if (window.location.pathname.endsWith('/quiz.html'))
            document.addEventListener('strobot:learner-scope-changed', () => window.location.reload());
        
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
