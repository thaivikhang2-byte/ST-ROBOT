import { $, $$ } from '../../utils/dom.js';
import { quizQuestions } from '../../data/quiz.js';

export class QuizService {
    getQuestions() {
        return [...quizQuestions];
    }
}
