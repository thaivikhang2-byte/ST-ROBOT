import { $ } from '../../utils/dom.js';

// Keep course and lesson IDs compatible with the existing learning app.
const FIRST_LESSONS = {
    microbit: {
        name: 'Micro:bit', id: 'matrix', title: 'Vẽ ý tưởng trên 25 LED',
        goal: 'Tạo một hình trên ma trận 5 × 5 và giải thích vị trí các điểm sáng.',
        equipment: 'Có thể bắt đầu với mô phỏng trong trình soạn thảo Python; chưa cần bo Micro:bit.'
    },
    arduino: {
        name: 'Arduino Uno', id: 'led', title: 'Mạch kín và LED',
        goal: 'Theo dõi đường đi của dòng điện và tìm hiểu vì sao LED cần điện trở hạn dòng.',
        equipment: 'Đọc hướng dẫn an toàn trước khi mắc mạch thật. Có thể thử trước trong mô phỏng.'
    },
    'vex-vr': {
        name: 'VEXcode VR', id: 'sequence', title: 'Chuỗi lệnh và hướng',
        goal: 'Dự đoán vị trí và hướng của robot sau mỗi lệnh di chuyển.',
        equipment: 'Bắt đầu với robot ảo trên trình duyệt; chưa cần mua bộ kit.'
    },
    'lego-spike': {
        name: 'LEGO SPIKE Prime', id: 'mechanism', title: 'Cơ cấu và góc quay',
        goal: 'Phân biệt góc quay của motor và góc quay của cơ cấu được truyền động.',
        equipment: 'Có thể đọc bài và thử mô phỏng trước. Khi dùng kit SPIKE thật, chọn đúng mã dành cho thiết bị.'
    },
    'vex-iq': {
        name: 'VEX IQ', id: 'drive', title: 'Cấu trúc và truyền động',
        goal: 'Giải thích cách một lệnh từ bộ điều khiển làm động cơ và robot chuyển động.',
        equipment: 'Có thể đọc bài và thử mô phỏng trước. Khi dùng kit VEX IQ thật, chọn đúng mã dành cho thiết bị.'
    }
};

const READINESS_ADVICE = {
    beginner: 'Bắt đầu bằng mục tiêu và ví dụ của bài 1. Chưa cần hiểu hết mã mẫu; thử thay một chi tiết nhỏ rồi quan sát kết quả.',
    practiced: 'Trước khi chạy mã mẫu, thử dự đoán kết quả. Sau đó đổi một giá trị, so sánh với dự đoán và làm câu hỏi tự kiểm tra.'
};

export class DangKyController {
    init() {
        const chooser = $('#startChooser');
        const courseSelect = $('#quickCourseSelect');
        const enterLink = $('#enterCourseLink');
        if (!chooser || !courseSelect || !enterLink) return;

        const update = () => {
            const courseId = Object.hasOwn(FIRST_LESSONS, courseSelect.value) ? courseSelect.value : 'microbit';
            const first = FIRST_LESSONS[courseId];
            const url = new URL('course.learning.html', document.baseURI);
            url.searchParams.set('course', courseId);
            url.searchParams.set('lesson', first.id);
            enterLink.href = url.href;
            enterLink.textContent = `Mở bài 1: ${first.name} →`;
            $('#startCourseName').textContent = `${first.name} · Bài 1 / 6`;
            $('#startLessonTitle').textContent = first.title;
            $('#startLessonGoal').textContent = first.goal;
            $('#startEquipment').textContent = first.equipment;
            const readiness = chooser.querySelector('input[name="readiness"]:checked')?.value;
            $('#readinessAdvice').textContent = READINESS_ADVICE[readiness] || READINESS_ADVICE.beginner;
        };

        chooser.addEventListener('change', update);
        update();
    }
}
