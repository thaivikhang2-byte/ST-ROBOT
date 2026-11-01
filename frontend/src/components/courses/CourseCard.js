import { ROUTES } from '../../constants/routes.js';
import { icon } from '../ui/icon.js';

export function renderCourses(host, courses) {
    host.replaceChildren(...courses.map(course => {
        const card = document.createElement('article');
        card.className = 'card card--interactive course-card';
        const media = document.createElement('div');
        media.className = 'card-media course-placeholder';
        media.innerHTML = icon('graduation');
        const body = document.createElement('div');
        body.className = 'card-body';
        const badge = document.createElement('span');
        badge.className = 'badge badge--primary';
        badge.textContent = course.tag;
        const title = document.createElement('h3');
        const link = document.createElement('a');
        link.className = 'course-link';
        link.href = `${ROUTES.COURSE_LEARNING}?course=${encodeURIComponent(course.id)}`;
        link.textContent = course.name;
        title.append(link);
        const description = document.createElement('p');
        description.textContent = course.desc;
        const count = document.createElement('p');
        count.className = 'text-small';
        count.textContent = `${course.lessonCount} bài học · Lý thuyết, lab & bài tập`;
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        const start = document.createElement('a');
        start.className = 'btn btn--primary';
        start.href = link.href;
        start.textContent = 'Vào học';
        actions.append(start);
        body.append(badge, title, description, count, actions);
        card.append(media, body);
        return card;
    }));
    host.setAttribute('aria-busy', 'false');
}
