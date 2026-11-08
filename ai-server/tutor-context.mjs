// These fixed capabilities mirror frontend/src/data/lab-platforms.js. Client
// input selects a known description; it can never supply system instructions.
export const COURSE_LAB_KEYS = Object.freeze({
  arduino: ['circuit', 'avr', 'wokwi', 'phet', 'local'],
  microbit: ['python', 'scratch', 'arcade', 'local'],
  'vex-iq': ['gears', 'scratch', 'arcade', 'local'],
  'lego-spike': ['gears', 'scratch', 'arcade', 'local'],
  'vex-vr': ['gears', 'scratch', 'arcade', 'local']
});
const platforms = Object.freeze({
  circuit: 'CircuitJS: mô phỏng mạch điện analog; không thực thi mã Arduino hoặc MicroPython.',
  avr: 'AVR8js: editor và mô phỏng Arduino C/C++ trên AVR.',
  wokwi: 'Wokwi Arduino Uno: mô phỏng số, dùng Arduino C/C++.',
  phet: 'PhET mạch điện DC: thí nghiệm mạch trực quan; không có editor thực thi mã.',
  python: 'micro:bit Python Editor: soạn và mô phỏng MicroPython, tải HEX.',
  gears: 'GearsBot: robot ảo 3D, lập trình Blockly hoặc Python theo API GearsBot; không mặc định API kit VEX hay SPIKE thật.',
  scratch: 'Scratch: khối lệnh và chạy dự án mẫu; editor đầy đủ mở ở tab ngoài.',
  arcade: 'MakeCode Arcade: Blocks hoặc TypeScript cho game simulator; không dùng API MicroPython của micro:bit.',
  local: 'Bàn thí nghiệm trong bài: mô hình tương tác theo tham số; không thực thi mã chương trình của học sinh.'
});
const levels = Object.freeze({
  beginner: 'Mới bắt đầu: dùng từ đơn giản, giải thích một bước nhỏ mỗi lần, kiểm tra học sinh hiểu trước khi nâng mức.',
  intermediate: 'Đã có nền tảng: giải thích nguyên nhân, đề xuất cách kiểm thử và gợi ý vừa đủ để học sinh tự làm.',
  advanced: 'Nâng cao: phân tích giả định, giới hạn và các trường hợp biên; khuyến khích tự thiết kế kiểm thử.'
});

export function tutorContextPrompt(data, courseId) {
  if (data.platformKey !== undefined && (typeof data.platformKey !== 'string'
    || !COURSE_LAB_KEYS[courseId]?.includes(data.platformKey))) throw new TypeError('Invalid tutor platform');
  if (data.learningLevel !== undefined && (typeof data.learningLevel !== 'string'
    || !Object.hasOwn(levels, data.learningLevel))) throw new TypeError('Invalid tutor level');
  return [
    data.platformKey === undefined ? '' : `Nền tảng học sinh đã chọn: ${platforms[data.platformKey]} Mã trong giáo trình là ví dụ của bài, không phải mã đang mở trong nền tảng này. Chỉ xem mã hoặc trạng thái editor hiện tại là đã cung cấp khi học sinh gửi chúng trong câu hỏi hoặc ảnh. Hướng dẫn theo ngôn ngữ và khả năng của nền tảng đã chọn.`,
    data.learningLevel === undefined ? '' : `Mức hướng dẫn: ${levels[data.learningLevel]}`
  ].filter(Boolean).join('\n');
}
