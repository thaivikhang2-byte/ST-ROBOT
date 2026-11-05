import { listTemplates } from './generation/QuestionEngine.js';

const requestFields = new Set(['courseId', 'lessonId', 'count', 'level', 'weakLessonIds']);
const levels = new Set(['all', 'basic', 'apply', 'reason']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class PracticePlanError extends Error {
  constructor(status, message) { super(message); this.name = 'PracticePlanError'; this.status = status; }
}

export function preparePracticePlan(data, curriculum) {
  const invalid = () => { throw new PracticePlanError(400, 'Chọn khóa, bài, mức độ và số câu từ 1 đến 18 để lập lượt luyện tập.'); };
  if (!isObject(data) || Object.keys(data).some(key => !requestFields.has(key))) invalid();
  if (typeof data.courseId !== 'string' || typeof data.lessonId !== 'string' || !Number.isInteger(data.count) || data.count < 1 || data.count > 18 || !levels.has(data.level)) invalid();
  const course = curriculum.find(item => item.id === data.courseId);
  if (!course || (data.lessonId !== 'all' && !course.lessons.some(lesson => lesson.id === data.lessonId))) invalid();
  const weakLessonIds = data.weakLessonIds === undefined ? [] : data.weakLessonIds;
  if (!Array.isArray(weakLessonIds) || weakLessonIds.length > 6 || new Set(weakLessonIds).size !== weakLessonIds.length || weakLessonIds.some(id => typeof id !== 'string' || !course.lessons.some(lesson => lesson.id === id))) invalid();
  const focusIds = data.lessonId === 'all' ? weakLessonIds : [];
  const catalog = listTemplates({ courseId: data.courseId, lessonId: data.lessonId, level: data.level })
    .filter(template => !focusIds.length || focusIds.includes(template.lessonId));
  if (!Array.isArray(catalog) || !catalog.length) throw new PracticePlanError(400, 'Chọn nội dung có mẫu câu luyện tập để tiếp tục.');
  const lessons = course.lessons.filter(lesson => (data.lessonId === 'all' || lesson.id === data.lessonId) && (!focusIds.length || focusIds.includes(lesson.id)));
  const relevantWeakIds = weakLessonIds.filter(id => lessons.some(lesson => lesson.id === id));
  return {
    count: data.count,
    allowedIds: new Set(catalog.map(template => template.id)),
    messages: [
      {
        role: 'system',
        content: 'Bạn chọn mẫu câu luyện tập STEM Robotics từ danh sách được cung cấp. Chỉ trả một đối tượng JSON đúng cấu trúc {"templateIds":["id"]}. Chọn từ 1 đến số lượng yêu cầu, tối đa 18 ID khác nhau, tất cả phải thuộc danh sách. Ưu tiên bài còn cần ôn; nếu chọn cả khóa, phân bố mẫu trên các bài phù hợp thay vì tập trung một bài. Mỗi ID xuất hiện một lần; bộ tạo câu sẽ tự bổ sung số câu còn thiếu từ các mẫu đã kiểm chứng. Không viết câu hỏi, đáp án, giải thích, mã thực thi hoặc trường JSON khác.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          courseId: course.id,
          courseName: course.name,
          lessonId: data.lessonId,
          count: data.count,
          level: data.level,
          weakLessonIds: relevantWeakIds,
          lessons: lessons.map(lesson => ({ id: lesson.id, title: lesson.title, objectives: lesson.objectives || [lesson.goal] })),
          templates: catalog.map(template => ({ id: template.id, courseId: template.courseId, lessonId: template.lessonId, skillId: template.skillId, level: template.level, variantCount: template.variantCount }))
        })
      }
    ]
  };
}

export function parsePracticePlan(content, allowedIds, count) {
  const invalid = () => { throw new PracticePlanError(502, 'Kế hoạch AI chưa hợp lệ. Hãy dùng lượt luyện tập được tạo sẵn.'); };
  if (typeof content !== 'string' || content.length > 16000) invalid();
  let json = content.trim();
  if (json.startsWith('```')) {
    // A single whole-response fence is accepted; prose and partial JSON extraction are not.
    const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(json);
    if (!fenced) invalid();
    json = fenced[1].trim();
  }
  let result;
  try { result = JSON.parse(json); } catch { invalid(); }
  if (!isObject(result) || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'templateIds') || !Array.isArray(result.templateIds) || !result.templateIds.length || result.templateIds.length > Math.min(count, 18) || new Set(result.templateIds).size !== result.templateIds.length || result.templateIds.some(id => typeof id !== 'string' || !allowedIds.has(id))) invalid();
  return [...result.templateIds];
}
