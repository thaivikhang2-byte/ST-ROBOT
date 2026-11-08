/* Structured lesson content. Build text nodes so lesson text cannot become markup. */
(() => {
    const textElement = (tag, text, className) => {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const list = items => {
        const node = document.createElement('ul');
        for (const item of items) node.append(textElement('li', item));
        return node;
    };
    const section = (key, title) => {
        const node = document.createElement('section');
        node.dataset.theorySection = key;
        node.className = 'theory-section';
        node.append(textElement('h3', title));
        return node;
    };
    function renderTheory(host, lesson) {
        host.replaceChildren();
        const objectives = section('objectives', 'Sau bài này, bạn có thể');
        objectives.append(list(lesson.objectives || [lesson.goal]));
        const concepts = section('concepts', 'Hiểu từng bước');
        const blocks = lesson.concepts?.length ? lesson.concepts : [{ title: 'Kiến thức cốt lõi', body: lesson.theory }];
        for (const [index, block] of blocks.entries()) {
            const article = document.createElement('div');
            article.className = 'concept-block';
            article.append(textElement('h4', `${index + 1}. ${block.title}`));
            for (const paragraph of block.body.split('\n\n')) article.append(textElement('p', paragraph));
            concepts.append(article);
        }
        const example = section('example', 'Ví dụ có lời giải');
        example.classList.add('worked-example');
        example.append(textElement('p', lesson.example));
        const mistakes = section('misconceptions', 'Lỗi thường gặp và cách tránh');
        mistakes.append(list(lesson.misconceptions || []));
        const selfCheck = section('self-check', 'Tự kiểm tra trước khi thực hành');
        selfCheck.append(list(lesson.selfCheck || []));
        const sources = section('sources', 'Đọc thêm từ nguồn chính thức');
        const details = document.createElement('details');
        details.append(textElement('summary', 'Mở tài liệu tham khảo'));
        const links = document.createElement('ul');
        for (const source of lesson.sources || []) {
            let url;
            try { url = new URL(source.url); } catch { continue; }
            if (url.protocol !== 'https:') continue;
            const item = document.createElement('li');
            const link = textElement('a', source.title);
            link.href = url.href;
            link.rel = 'noopener noreferrer';
            item.append(link);
            links.append(item);
        }
        details.append(links);
        sources.append(details);
        host.append(objectives, concepts, example, mistakes, selfCheck, sources);
    }
    function renderLearningGuide(host, lesson, { level = 'beginner' } = {}) {
        host.replaceChildren();
        const guide = lesson.learningGuide;
        host.hidden = !guide;
        if (!guide) return;
        const labels = {
            beginner: 'Mới bắt đầu',
            intermediate: 'Đã học cơ bản',
            advanced: 'Muốn tìm hiểu sâu'
        };
        const selected = Object.hasOwn(labels, level) ? level : 'beginner';
        host.classList.add('learning-guide');
        host.dataset.learningLevel = selected;
        const guideSection = (key, title) => {
            const node = document.createElement('section');
            node.className = `learning-guide-section learning-guide-${key}`;
            node.dataset.guideSection = key;
            node.append(textElement('h4', title));
            return node;
        };
        const paragraph = (hostNode, value, className) => {
            for (const body of String(value || '').split('\n\n')) {
                if (body) hostNode.append(textElement('p', body, className));
            }
        };
        host.append(textElement('h3', 'Cùng hiểu bài từ đầu', 'learning-guide-heading'));
        paragraph(host, guide.intro, 'learning-guide-intro');

        if (guide.analogy) {
            const analogy = guideSection('analogy', 'Hình dung bằng một việc quen thuộc');
            paragraph(analogy, guide.analogy.familiar, 'learning-guide-familiar');
            paragraph(analogy, guide.analogy.meaning);
            const limit = document.createElement('div');
            limit.className = 'learning-guide-limit';
            limit.append(textElement('strong', 'Ví von có giới hạn'));
            paragraph(limit, guide.analogy.limit);
            analogy.append(limit);
            host.append(analogy);
        }

        if (guide.vocabulary?.length) {
            const vocabulary = guideSection('vocabulary', 'Những từ cần hiểu');
            const definitions = document.createElement('dl');
            definitions.className = 'learning-guide-vocabulary';
            for (const entry of guide.vocabulary) {
                const pair = document.createElement('div');
                pair.append(textElement('dt', entry.term), textElement('dd', entry.definition));
                definitions.append(pair);
            }
            vocabulary.append(definitions);
            host.append(vocabulary);
        }

        if (guide.workedCase) {
            const worked = guideSection('case', guide.workedCase.title);
            worked.append(textElement('p', 'Cùng làm một trường hợp nhỏ', 'learning-guide-eyebrow'));
            const input = document.createElement('div');
            input.className = 'learning-guide-case-input';
            input.append(textElement('strong', 'Bắt đầu với'));
            paragraph(input, guide.workedCase.input);
            worked.append(input);
            const steps = document.createElement('ol');
            steps.className = 'learning-guide-case-steps';
            for (const step of guide.workedCase.steps || []) {
                const item = document.createElement('li');
                item.append(textElement('h5', step.title));
                paragraph(item, step.explanation);
                steps.append(item);
            }
            worked.append(steps);
            const output = document.createElement('div');
            output.className = 'learning-guide-case-output';
            output.append(textElement('strong', 'Kết quả và ý nghĩa'));
            paragraph(output, guide.workedCase.output);
            paragraph(output, guide.workedCase.why);
            worked.append(output);
            host.append(worked);
        }

        if (guide.checkpoints?.length) {
            const checkpoints = guideSection('checkpoints', 'Dừng một chút để tự giải thích');
            paragraph(checkpoints, 'Thử trả lời bằng lời của bạn trước, rồi mở gợi ý để đối chiếu.');
            for (const [index, checkpoint] of guide.checkpoints.entries()) {
                const card = document.createElement('div');
                card.className = 'learning-guide-checkpoint';
                card.append(textElement('p', `${index + 1}. ${checkpoint.question}`));
                const reveal = document.createElement('details');
                reveal.append(textElement('summary', 'Mở lời giải thích'));
                paragraph(reveal, checkpoint.answer);
                card.append(reveal);
                checkpoints.append(card);
            }
            host.append(checkpoints);
        }

        if (guide.levelSupport) {
            const support = guideSection('support', 'Chọn độ sâu phù hợp với bạn');
            paragraph(support, 'Bạn có thể đổi mức đọc bất cứ lúc nào. Mức đọc dựa trên điều bạn đã biết, không dựa vào lớp học.');
            const current = guide.levelSupport[selected];
            if (current && selected !== 'advanced') {
                const card = document.createElement('div');
                card.className = 'learning-guide-level';
                card.append(textElement('span', labels[selected], 'learning-guide-eyebrow'));
                card.append(textElement('h5', current.title));
                paragraph(card, current.body);
                paragraph(card, current.task, 'learning-guide-try');
                support.append(card);
            }
            const advanced = guide.levelSupport.advanced;
            if (advanced) {
                const more = document.createElement('details');
                more.className = 'learning-guide-deeper';
                more.open = selected === 'advanced';
                more.append(textElement('summary', `${labels.advanced}: ${advanced.title}`));
                paragraph(more, advanced.body);
                paragraph(more, advanced.task, 'learning-guide-try');
                support.append(more);
            }
            host.append(support);
        }
    }
    window.STROBOT_LESSON_VIEW = { renderTheory, renderLearningGuide };
})();
