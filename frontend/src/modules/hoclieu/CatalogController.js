import { courses } from '../../data/courses.js';
import { renderCourses } from '../../components/courses/CourseCard.js';

export class CatalogController {
    init() {
        const search = document.getElementById('catalogSearch');
        const category = document.getElementById('catalogCategoryFilter');
        const host = document.getElementById('catalogCoursesGrid');
        for (const course of courses) {
            const option = document.createElement('option');
            option.value = course.id;
            option.textContent = course.name;
            category.append(option);
        }
        const update = () => {
            const term = search.value.trim().toLocaleLowerCase('vi');
            const results = courses.filter(course =>
                (!category.value || category.value === course.id) &&
                `${course.name} ${course.desc} ${course.tag} ${course.tools}`.toLocaleLowerCase('vi').includes(term));
            renderCourses(host, results);
            document.getElementById('catalogCount').textContent = results.length
                ? `${results.length} khóa học` : 'Không tìm thấy khóa học phù hợp. Hãy thử từ khóa khác.';
        };
        search.addEventListener('input', update);
        category.addEventListener('change', update);
        update();
    }
}
