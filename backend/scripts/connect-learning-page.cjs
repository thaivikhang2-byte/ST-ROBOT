// Preserve the supplied HTML layout and genuine local numerical benches.
// Authored materials, answer keys and PDF solutions are now served from protected backend routes.
const fs = require('node:fs');
const path = require('node:path');
const original = fs.readFileSync(path.resolve(__dirname, '../../.phase3-backup/phase5-baseline-20261023/frontend-public/course.learning.html'), 'utf8');
const benchStart = original.indexOf('// Local numerical/logic benches:');
const benchEnd = original.indexOf("window.addEventListener('DOMContentLoaded',initPage);", benchStart);
if (benchStart < 0 || benchEnd < 0) throw new Error('Expected local bench source not found');
let html = original.slice(0, original.indexOf('<script>'));
html = html.replace('Tiến độ lưu trên trình duyệt; trang này không xác nhận thanh toán.', 'Đăng nhập để lưu tiến độ và kết quả trên máy chủ; trang này không xác nhận thanh toán.');
html = html.replace('<form id="quizForm">', '<div id="quizForm">').replace('</form><h3>Nhật ký thực hành', '</div><h3>Nhật ký thực hành');
html = html.replace('maxlength="15000"', 'maxlength="10000"');
html = html.replace('Ghi đầu vào, dự đoán, kết quả, lỗi và giải thích (ít nhất 60 ký tự)', 'Ghi đầu vào, dự đoán, kết quả, lỗi và giải thích (khuyến nghị ít nhất 60 ký tự)');
html = html.replace('Rubric giáo viên đối chiếu · 100 điểm', 'Tiêu chí chuẩn bị bài thực hành');
html = html.replace('Mỗi tiêu chí: đủ chứng cứ = toàn điểm; thiếu một phần = nửa điểm; chưa có = 0. Trang chỉ kiểm tra trắc nghiệm và lưu nhật ký, không tự chấm nội dung iframe bên ngoài.', 'Quiz được chấm trên máy chủ. Bài thực hành chờ giáo viên đánh giá; không tự chấm ứng dụng mô phỏng bên ngoài.');
html = html.replace('2. Phòng Lab Mini (Nhúng Trực Tiếp)', '2. Phòng Lab Mini');
html = html.replace('Mở Phòng Lab Ngay Trong Web', 'Mở Phòng Lab');
html = html.replace('Đánh dấu hoàn thành tự học', 'Lưu hoàn thành bài');
html = html.replace('<div class="flex-1 overflow-y-auto p-3 space-y-2" id="lessonList">', '<div id="learningAccount" class="course-picker"></div><div id="learningDashboard" class="course-picker"></div><div class="flex-1 overflow-y-auto p-3 space-y-2" id="lessonList">');
const helpers = `
const $=id=>document.getElementById(id);
let course={id:''}, benchMaterial={};
function lesson(){return benchMaterial}
export function setBenchLesson(sourceId,material){course={id:sourceId};benchMaterial=material;renderLocal()}
`;
const bench = original.slice(benchStart, benchEnd).replaceAll('onclick="runBench()"', 'data-run-bench').replace('}runBench()}', "}$('benchControls').querySelector('[data-run-bench]').onclick=runBench;runBench()}");
fs.writeFileSync(path.resolve(__dirname, '../../frontend/src/modules/learning/LocalBench.js'), helpers + bench);
const replacements = {
  "document.getElementById('enrollmentBanner').style.display='none'": 'data-action="dismiss-banner"',
  'openPdfModal()': 'data-action="reference"', 'closePdfModal()': 'data-action="close-reference"',
  "switchMainTab('theory')": 'data-tab="theory"', "switchMainTab('lab')": 'data-tab="lab"',
  'markLessonComplete()': 'data-action="complete"', 'copySampleCode()': 'data-action="copy-code"', 'lessonHint()': 'data-action="hint"',
};
html = html.replace(/onclick="([^"]*)"/g, (_, action) => {
  if (replacements[action]) return replacements[action];
  const prompt = /^sendQuickPrompt\('([^']+)'\)$/.exec(action);
  if (prompt) return 'data-prompt="' + prompt[1].replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"';
  throw new Error('Unmapped learning-page action: ' + action);
}).replace('onsubmit="handleChatSubmit(event)"', 'id="learningChatForm"');
html += '<script type="module" src="../src/modules/learning/CourseLearningController.js"></script>\n</body></html>\n';
if (html.includes('const COURSES=') || html.includes('const PDFS=')) throw new Error('Protected content remains in public HTML');
fs.writeFileSync(path.resolve(__dirname, '../../frontend/public/course.learning.html'), html);
console.log('Connected learning HTML; original layout/local benches retained, embedded grading keys/PDFs removed.');
