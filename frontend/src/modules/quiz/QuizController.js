import { QuizService } from './QuizService.js';
import { QuizRenderer } from './QuizRenderer.js';
import { $ } from '../../utils/dom.js';

export class QuizController {
    constructor() {
        this.service = new QuizService();
        this.renderer = new QuizRenderer();
        this.randomizedSet = [];
        this.activeIndex = 0;
        this.earnedPoints = 0;
        this.optionSelected = false;
    }

    init() {
        this.attachEvents();
    }

    attachEvents() {
        const btnInit = $('#btnInitQuiz');
        if (btnInit) btnInit.addEventListener('click', () => this.executeQuizInit());

        const btnRestart = $('#btnRestartQuiz');
        if (btnRestart) btnRestart.addEventListener('click', () => this.executeQuizInit());

        const btnBack = $('#btnBackIntro');
        if (btnBack) btnBack.addEventListener('click', () => this.renderer.showIntro());

        const btnForward = $('#forwardBtn');
        if (btnForward) btnForward.addEventListener('click', () => this.advanceNextQuestion());
    }

    executeQuizInit() {
        this.randomizedSet = this.service.getQuestions().sort(() => Math.random() - 0.5);
        this.activeIndex = 0;
        this.earnedPoints = 0;
        
        this.renderer.showGame();
        this.displayCurrentQuestion();
    }

    displayCurrentQuestion() {
        this.optionSelected = false;
        let activeData = this.randomizedSet[this.activeIndex];
        
        this.renderer.renderQuestion(activeData, this.activeIndex, (clickedBtn, selectedIdx) => {
            this.evaluateUserChoice(clickedBtn, selectedIdx);
        });
    }

    evaluateUserChoice(clickedBtn, selectedIdx) {
        if (this.optionSelected) return;
        this.optionSelected = true;
        
        let currentCorrectIdx = this.randomizedSet[this.activeIndex].ans;
        if (selectedIdx === currentCorrectIdx) {
            clickedBtn.classList.add("answer-correct");
            this.earnedPoints++;
        } else {
            clickedBtn.classList.add("answer-wrong");
        }
        
        this.renderer.showFeedback(this.randomizedSet[this.activeIndex].exp);
    }

    advanceNextQuestion() {
        this.activeIndex++;
        if (this.activeIndex < this.randomizedSet.length) {
            this.displayCurrentQuestion();
        } else {
            this.concludeQuizSession();
        }
    }

    concludeQuizSession() {
        this.renderer.showSummary(this.earnedPoints, this.randomizedSet.length);
    }
}
