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
    window.STROBOT_LESSON_VIEW = { renderTheory };
})();
