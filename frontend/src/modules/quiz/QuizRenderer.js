import { $ } from '../../utils/dom.js';

export class QuizRenderer {
    showIntro() {
        $('#quizIntroArea').style.display = 'block';
        $('#quizActiveGame').style.display = 'none';
        $('#quizSummaryArea').style.display = 'none';
    }

    showGame() {
        $('#quizIntroArea').style.display = 'none';
        $('#quizSummaryArea').style.display = 'none';
        $('#quizActiveGame').style.display = 'block';
    }

    showSummary(earnedPoints, total) {
        $('#quizActiveGame').style.display = 'none';
        $('#quizSummaryArea').style.display = 'block';
        $('#totalScoreText').innerText = `Hệ thống ghi nhận kết quả bài thi thử của bạn đạt: ${earnedPoints} / ${total} câu trả lời chính xác.`;
    }

    renderQuestion(activeData, activeIndex, onSelect) {
        $('#targetQuestionPlaceholder').innerText = `Câu hỏi ${activeIndex + 1}: ${activeData.q}`;
        $('#feedbackBox').style.display = 'none';
        $('#forwardBtn').style.display = 'none';
        
        const container = $('#answerOptionsArea');
        container.innerHTML = '';
        
        activeData.opts.forEach((txt, idx) => {
            let optButton = document.createElement("button");
            optButton.className = "answer-btn";
            optButton.innerText = txt;
            optButton.addEventListener('click', () => onSelect(optButton, idx));
            container.appendChild(optButton);
        });
    }

    showFeedback(exp) {
        let infoBox = $('#feedbackBox');
        infoBox.innerText = `Phân tích giải thích: ${exp}`;
        infoBox.style.display = 'block';
        $('#forwardBtn').style.display = 'block';
    }
}
