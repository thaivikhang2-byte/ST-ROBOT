import {getArduinoGuide} from './guides/ArduinoGuides.js';
import {getLocalGuide} from './guides/LocalGuides.js';
import {getBlockGuide} from './guides/BlockGuides.js';

// These are the choices in lab-platforms.js, not a claim of hardware compatibility.
const OFFERED = {
    arduino: ['circuit', 'avr', 'wokwi', 'phet', 'local'],
    microbit: ['python', 'scratch', 'arcade', 'local'],
    'vex-iq': ['gears', 'scratch', 'arcade', 'local'],
    'lego-spike': ['gears', 'scratch', 'arcade', 'local'],
    'vex-vr': ['gears', 'scratch', 'arcade', 'local']
};
const LESSONS = {
    arduino: ['led', 'timing', 'distance', 'alarm', 'calibration', 'project'],
    microbit: ['matrix', 'buttons', 'light', 'counter', 'radio', 'project'],
    'vex-iq': ['drive', 'turn', 'detect', 'mission', 'odometry', 'control'],
    'lego-spike': ['mechanism', 'colors', 'sort', 'project', 'ratio', 'state'],
    'vex-vr': ['sequence', 'loop', 'avoid', 'challenge', 'search', 'experiment']
};

const PYTHON_ACTIVITIES = {
    matrix: {
        steps: ['Dự đoán năm điểm sáng từ danh sách points. Chọn Run trong editor và kiểm tra (2,2), (1,2), (3,2), (2,1), (2,3) trên ma trận.', 'Đổi riêng danh sách points thành [(0,0),(0,1),(0,2),(0,3),(0,4),(1,4),(2,4),(3,4),(4,4)] rồi Run lại: đây là chữ L chín điểm.', 'Thử bật lại một tọa độ đã sáng; ghi vì sao số điểm sáng không tăng. Lưu hai hình và hai danh sách tọa độ.'],
        expected: ['Mã đầu hiện chữ thập 5 LED; bản sửa hiện chữ L 9 LED.', 'Gốc (0,0) ở trên trái; x sang phải, y xuống dưới; tọa độ hợp lệ 0..4.'],
        evidence: ['Ảnh chữ thập/chữ L và danh sách points tương ứng; chỉ ra một tọa độ thay đổi.']
    },
    buttons: {
        steps: ['Run rồi bấm A, A, B chậm trên micro:bit mô phỏng. Ghi hình sau từng lần: tim, tim, trống.', 'Run lại rồi thử B,A: trống, tim. Giữ A lâu và đối chiếu với một lần bấm: was_pressed là dấu đã bấm, không phải điều kiện giữ nút liên tục.', 'Đọc hai nhánh if theo thứ tự; thử A/B gần nhau. Chỉ khi cùng được ghi nhận trong một lượt thăm dò thì nhánh B chạy sau và xóa. Không dùng hai lần bấm chuột liên tiếp để khẳng định chúng đồng thời.'],
        expected: ['A hiện Image.HEART, B xóa; thứ tự cuối B,A khác A,B.', 'Nếu cả A/B được chốt cùng lượt đọc, B thắng theo thứ tự hai if.'],
        evidence: ['Bảng A,A,B và B,A với hình dự đoán/hình quan sát; ghi riêng thử nhanh có xác nhận được cùng lượt đọc hay không.']
    },
    light: {
        steps: ['Run mẫu; mở điều khiển ánh sáng của simulator rồi đặt 79,80,81 nếu điều khiển cho nhập chính xác. Nếu chỉ kéo thanh, ghi giá trị thực tế mà simulator cho chọn.', 'Giữ ngưỡng 80: ghi 79 hiện tim, 80 và 81 xóa. Đổi số 80 trong điều kiện thành 100 rồi Run lại; kiểm tra 99,100,101.', 'Lần đọc đầu được bỏ và nghỉ 200 ms để khởi tạo; trong vòng lặp nghỉ 100 ms. Ghi cả độ trễ quan sát. Nếu simulator không cho tạo giá trị biên chính xác, dùng Bàn thí nghiệm để kiểm tra số học và ghi rõ nguồn kết quả.'],
        expected: ['Điều kiện level < 80 loại đúng biên 80; mức đọc là giá trị tương đối 0..255, không phải lux.', 'Kết quả LED được quyết định từ số đọc, không phải ánh sáng phòng qua camera.'],
        evidence: ['Bảng mức sáng thực dùng/ngưỡng/hình, gồm dưới ngưỡng, đúng biên nếu đặt được và trên ngưỡng.']
    },
    counter: {
        steps: ['Run và chờ thấy 0; bấm chậm A,A,B,B,A, ghi count kỳ vọng 1,2,0,0,1. Chờ chữ cuộn đủ trước ca đầu.', 'Run lại kiểm tra khởi tạo 0. get_presses lấy số lần A từ lần đọc trước; count += presses giữ lịch sử thay vì gán lại 1.', 'Thử A/B gần nhau. Nếu B được chốt cùng lượt thăm dò thì reset thắng; chữ cuộn không chặn nên bấm nhanh có thể thay hình trước khi cuộn xong.'],
        expected: ['Chuỗi khởi động,A,A,B,B,A cho 0,1,2,0,0,1.', 'Run khởi động lại biến; hình cuộn chưa hoàn tất không đồng nghĩa biến đếm sai.'],
        evidence: ['Bảng sự kiện/count từng bước và một lần Run lại; phân biệt giá trị biến với phần chữ đang cuộn.']
    },
    radio: {
        steps: ['Run mã bên nhận. Mở bảng Radio của simulator nếu có và đặt nhóm 7; gửi từng chuỗi MicroPython temp:23, temp:-20, temp:60.', 'Gửi temp:999, other:22 và một chuỗi sai định dạng. Chúng phải bị bỏ; để đọc giá trị đã lưu sau đó, thêm print(last_valid) ngay trước sleep(20), thụt vào bốn khoảng trắng, rồi xem đầu ra print.', 'Đổi nhóm gửi thành 8 để thử nhóm sai, sau đó trở lại 7. Nếu simulator không có bộ gửi radio, tải HEX lên hai bo micro:bit: nạp mẫu bên gửi cho bo thứ hai và cùng nhóm 7. Hai tab editor không tự kết nối radio.', 'Dùng cùng giao thức chuỗi name:value ở hai đầu. Không dùng MakeCode sendValue thay thế; không gửi dữ liệu riêng tư vì nhóm radio không phải mật khẩu.'],
        expected: ['Bản tin hợp lệ cập nhật last_valid; sai tên, sai định dạng hoặc ngoài −20..60 giữ giá trị hợp lệ trước.', 'Màn hình có thể trống sau cuộn; dùng đầu ra print để xác nhận giá trị lưu. Không nhận mới khác nhận số 0.'],
        evidence: ['Bảng nhóm/chuỗi/kết quả nhận/last_valid; ghi dùng bộ gửi simulator hay hai bo thật.']
    },
    project: {
        steps: ['Chốt bốn ca trước khi Run: khởi động=0; A,A=2; B=0; B,B=0. Ghi từng trạng thái, chờ số cuộn đủ khi kiểm thử chậm.', 'Run lại: phải về 0. Lưu mã đúng rồi tạo bản sao; đổi count += presses thành count = presses để chủ đích tạo lỗi.', 'Chạy lại A,A: bản lỗi không tích lũy thành 2. Ghi bước tái hiện, giá trị mong đợi và thực tế; khôi phục += rồi chạy lại toàn bộ ca.', 'Thử A/B gần nhau và giải thích chính sách B ưu tiên trong cùng lượt thăm dò. Ghi trường hợp chưa xác nhận được thời điểm, không gọi mọi chuỗi nhanh là đồng thời.'],
        expected: ['Bản đúng vượt bốn ca; bản count = presses thất bại ca A,A.', 'Sau sửa phải chạy lại các ca cũ, không chỉ ca từng lỗi.'],
        evidence: ['Bảng ca kiểm thử trước/sau sửa, đoạn thay đổi và chuỗi ngắn nhất tái hiện lỗi.']
    }
};

const RADIO_SENDER = `from microbit import *
import radio

radio.config(group=7)
radio.on()
messages = ["temp:23", "temp:-20", "temp:60", "temp:999", "other:22", "bad"]
index = 0
while True:
    if button_a.was_pressed():
        radio.send(messages[index])
        display.show(str(index + 1))
        index = (index + 1) % len(messages)
    sleep(20)
`;

function pythonGuide(lesson) {
    const activity = PYTHON_ACTIVITIES[lesson.id];
    return {
        title: `MicroPython · ${lesson.title}`, goal: lesson.goal, activityType: 'primary',
        capability: 'micro:bit Python Editor chạy MicroPython cho micro:bit. Mã ở đây dùng microbit, không dùng API MakeCode Python. Simulator và bảng điều khiển tùy phiên bản editor.',
        setupSteps: ['Chọn micro:bit Python Editor trong Lab; chờ editor tải. Mã mẫu được gửi bằng giao thức controller chính thức. Nếu đang giữ bản tự viết, tải bản sao trước khi thay mẫu.', 'Kiểm tra mã trong editor bắt đầu bằng from microbit import *. Dùng nút nạp mẫu của bài hoặc sao chép toàn bộ mã vào editor, sau đó chọn Run của editor.', 'Nếu iframe không tải, dùng Mở tab riêng tới https://python.microbit.org/v/3/, dán mã MicroPython; chỉnh sửa trong tab riêng không tự đồng bộ về ST-Robot.'],
        ...activity,
        troubleshooting: ['Không thấy thay đổi: kiểm tra đang Run mã của đúng bài và dừng/chạy lại sau khi sửa; nút mô hình trong trang không thực thi Python.', 'Lỗi import microbit trong Python máy tính: đây là MicroPython cho micro:bit, hãy chạy trong editor đã chọn hoặc trên bo.', 'Lưu tiến trình của ST-Robot và chương trình trong tab editor riêng là hai thao tác khác nhau; tải tệp .py để lưu bản mã.'],
        codeExamples: [{id: 'main', label: 'MicroPython · chương trình của bài', lang: 'MicroPython', code: lesson.code, extension: 'py'}, ...(lesson.id === 'radio' ? [{id: 'sender', label: 'MicroPython · bo gửi thứ hai (A gửi mẫu kế tiếp)', lang: 'MicroPython', code: RADIO_SENDER, extension: 'py'}] : [])],
        comparison: {mission: `Đối chiếu quy tắc của “${lesson.title}” giữa mô hình thao tác và chương trình MicroPython.`, measurements: activity.evidence, limit: lesson.id === 'radio' ? 'So sánh điều kiện chấp nhận bản tin; mô hình không đo tầm phủ sóng, mất gói hay bảo mật.' : 'So sánh đầu vào và trạng thái đầu ra; mô hình trong trang không chạy mã và không xác nhận độ trễ phần cứng.'}
    };
}

const GEARS_RESULTS = {
    drive: ['Robot tiến với yêu cầu 200 mm; console ghi Requested distance, GPS displacement và góc hai bánh. Chạy 3 lượt Reset để xem sai lệch.'],
    turn: ['Robot tiến 200 mm → quay phải 90° → tiến 200 mm; góc quay bánh mục tiêu khoảng 244,3°, khác góc thân 90°.'],
    detect: ['Với d < 20 cm mã dừng và ghi obstacle_threshold; đúng 20 chưa thỏa dấu <. Quá 10 giây ghi time_limit; lỗi đọc phải dừng motor.'],
    mission: ['Tuyến A/B cùng đến trạng thái lưới (3,2,nam); GPS endpoint và va chạm là bằng chứng riêng về chuyển động thật trong GearsBot.'],
    odometry: ['500 mm, bánh 56 mm, truyền trực tiếp cho khoảng 2,842 vòng bánh, 1023,1°. Đây là phép tính, robot không tự chạy.'],
    control: ['wheel_commands(0,-10) cho (25,35); wrap_deg(179-(-179)) cho -2°. Clamp giới hạn lệnh −100..100, không chứng minh hệ kín ổn định.'],
    mechanism: ['Cage Bot thực hiện tay chắn 0° → 30° → 0°; console có target_deg/measured_deg. Phép tính cuối in −30° cho bộ truyền giả định 12:36 khi motor 90°.'],
    colors: ['Đỏ → A, xanh → B, nhãn còn lại → CHECK; console ghi nhãn và khoảng cách riêng. Hiện diện dựa siêu âm, không dựa mất nhãn màu.'],
    sort: ['Giữ một vật không phát chu kỳ tay chắn lặp; nhận lượt mới sau 3 mẫu cách ít nhất 8 cm. gate_cycles chỉ tăng khi hạ/mở tay chắn hoàn tất.'],
    project: ['Console ghi planned, attempted, complete_test và từng RESULT. Tỷ lệ nhận dạng/chu kỳ tay chắn khác độ đúng ngăn đích; lượt lỗi vẫn ở mẫu số.'],
    ratio: ['12:36, 90 rpm, η=0,8 cho tốc độ ra −30 rpm và mô-men ước lượng 0,24 N·m; đây là tính toán, không đo tải motor.'],
    state: ['Console chuyển WAIT → CLASSIFY → WAIT_CLEAR → WAIT; lỗi/timeout chuyển ERROR và dừng motor. Giữ vật không tạo thêm lượt.'],
    sequence: ['F F R F cho trạng thái lưới (2,1,nam); mỗi ô 100 mm. Console ghi từng bước và GPS cuối, không đồng nhất hai hệ tọa độ.'],
    loop: ['4 lượt thân forward(200), turn_right(90) tạo 4 cạnh; console ghi Return-position error bằng mm. Đưa rẽ ngoài vòng lặp tạo đường khác.'],
    avoid: ['d < 20 cm chọn rẽ phải, ngược lại tiến 50 mm; console phân biệt goal_reached, time_limit, action_limit. Luật cục bộ có thể mắc trong hành lang chữ U.'],
    challenge: ['A: 5 tiến/3 rẽ; B: 7 tiến/2 rẽ, cùng tới (3,2). Với giá 1/3 s B rẻ hơn; 2/0,2 s A rẻ hơn. Giây là chi phí khai báo.'],
    search: ['Console in Path và Forward steps; thay bản đồ 4×3, tường (1,0),(1,1) được 5 bước; thêm (1,2) cho None.'],
    experiment: ['BFS/DFS dùng cùng 3 bản đồ; vách kín ở sân 3 cho no_path. Completion giữ các lượt thất bại; chi phí trung bình chỉ tính tuyến thành công.']
};
const GEARS_MATH = ['odometry', 'control', 'ratio', 'challenge', 'search', 'experiment'];

function gearsGuide(courseId, lesson) {
    const arithmetic = GEARS_MATH.includes(lesson.id);
    const cage = courseId === 'lego-spike' && !arithmetic;
    const setupSteps = arithmetic ? [
        'Mở GearsBot và chuyển tab lập trình sang Python; chọn môi trường ev3dev2 nếu có lựa chọn ngôn ngữ. Mã bài này dùng Python 3 để tính toán, không ra lệnh motor.',
        'Sao chép toàn bộ mẫu vào editor Python, mở vùng console/output rồi Run. Có thể chạy cùng mã trong Python 3; không dán vào Scratch hay Arduino.'
    ] : cage ? [
        'Mở GearsBot → Robot → Select Robot → Cage Bot. Chuyển sang Python (ev3dev2). Tay chắn là OUTPUT_C/outC; cảm biến màu in3; siêu âm in4; A/B dành cho bánh xe.',
        'Với bài có đọc màu, chuẩn bị hộp đỏ, xanh và vàng bằng Worlds → World Builder; đặt mặt màu ngang cảm biến. Dùng joystick tới ≤ 3 cm, dừng bánh; lùi ≥ 8 cm giữa vật. Giữ cùng sân và tư thế xuất phát.',
        'Dán toàn bộ mẫu Python, nhấn Reset trước Run để encoder tay chắn về mốc. Mở console để đọc nhãn, khoảng cách, trạng thái và timeout.'
    ] : [
        'Mở GearsBot → Robot → Select Robot → Single Sensor Line Follower (singleFollower), chuyển sang Python (ev3dev2). Bánh trái A, bánh phải B, siêu âm INPUT_2, GPS INPUT_4.',
        'Dùng sân rộng phẳng và cùng tư thế xuất phát. Mẫu giả định bánh 56 mm, khoảng cách bánh 152 mm. Với detect/avoid đặt hộp trước robot; bảo đảm có chỗ cho các đoạn tiến/rẽ.',
        'Dán toàn bộ chương trình, mở console; nhấn Reset rồi Run trước mỗi lượt. Không dùng API VEX hoặc SPIKE trong editor ev3dev2 này.'
    ];
    return {
        title: `${arithmetic ? 'GearsBot Python · tính toán' : 'GearsBot · thử robot'} · ${lesson.title}`,
        goal: lesson.goal, activityType: 'primary',
        capability: arithmetic ? 'Editor GearsBot chạy phép tính Python; chương trình này chỉ in kết quả, không điều khiển robot hay tự đo thời gian.' : `GearsBot chạy ev3dev2 Python trên robot ${cage ? 'Cage Bot' : 'Single Sensor Line Follower'}. Đây là robot GearsBot, không giả lập firmware VEX/LEGO và không chạy trực tiếp trên kit thật.`,
        setupSteps,
        steps: [lesson.labGuide, `Trước Run, ghi dự đoán từ yêu cầu: ${lesson.goal}`, 'Ghi kết quả console cùng các tham số đã dùng. Chỉ đổi một tham số/điều kiện trong lượt tiếp theo và Reset khi có chuyển động; lưu cả lỗi, timeout và lượt chưa tới đích.'],
        expected: GEARS_RESULTS[lesson.id],
        evidence: [arithmetic ? 'Lưu mã, tham số đầu vào và các dòng console; chỉ ra giá trị tính từ giả thiết, không gọi là số đo robot.' : 'Lưu profile robot/sân, tham số, console và ảnh tư thế trước/sau; ghi Reset, số lượt và lỗi gặp.'],
        troubleshooting: arithmetic ? ['Không có chuyển động là đúng với mẫu tính toán. Xem console; chạy lại sau khi sửa dữ liệu đầu vào.', 'BFS/DFS no_path khác hết ngân sách; giữ nguyên lý do dừng trong bảng kết quả.'] : ['Lỗi cổng/cảm biến: chọn đúng profile robot và Reset; Cage Bot có siêu âm in4, khác singleFollower INPUT_2.', 'Motor timeout hoặc stalled: Stop, kiểm tra vật cản/mốc tay chắn rồi mới Reset. Không bỏ finally dừng motor để ép chương trình tiếp tục.', 'Màu CHECK: kiểm tra hộp ở ngang cảm biến và trong vùng ≤ 3 cm; màu được đo khác nhãn bạn kỳ vọng. Ghi CHECK thành kết quả thử.'],
        codeExamples: [{id: 'main', label: arithmetic ? 'Python 3 · phân tích trong console' : 'GearsBot · ev3dev2 Python', lang: arithmetic ? 'Python 3' : 'Python · ev3dev2', code: lesson.code, extension: 'py'}],
        comparison: {mission: `Đối chiếu “${lesson.title}” với Bàn thí nghiệm của cùng bài.`, measurements: GEARS_RESULTS[lesson.id], limit: arithmetic ? 'So cùng dữ liệu và quy ước số học. Không dùng giây chi phí khai báo để kết luận tốc độ robot.' : cage ? 'So quy tắc nhận vật/trạng thái và số chu kỳ; Cage Bot không tự chứng minh cơ cấu SPIKE phân vật đúng ngăn hay có bộ truyền 12:36.' : 'So thứ tự lệnh/ngưỡng/trạng thái logic; một ô lưới là quy ước. GPS, encoder, quán tính và va chạm chỉ có trong phép thử robot.'}
    };
}

/** Pure content API. Pass the current curriculum lesson object, including its code. */
export function getPlatformGuide({course, lesson, platformKey, level = 'beginner'} = {}) {
    const courseId = typeof course === 'string' ? course : course?.id;
    if (!OFFERED[courseId]?.includes(platformKey)) throw new RangeError(`Nền tảng ${platformKey} không được cung cấp cho khóa ${courseId}.`);
    if (!lesson?.id || !LESSONS[courseId].includes(lesson.id)) throw new RangeError(`Không có bài ${lesson?.id} trong khóa ${courseId}.`);
    if (!['beginner', 'intermediate', 'advanced'].includes(level)) throw new RangeError(`Mức học không hợp lệ: ${level}`);
    let guide;
    if (platformKey === 'local') guide = getLocalGuide(courseId, lesson);
    else if (courseId === 'arduino') guide = getArduinoGuide(lesson, platformKey);
    else if (platformKey === 'python') guide = pythonGuide(lesson);
    else if (platformKey === 'gears') guide = gearsGuide(courseId, lesson);
    else guide = getBlockGuide(courseId, lesson, platformKey);
    if (!guide) throw new RangeError(`Chưa có hướng dẫn ${courseId}/${lesson.id}/${platformKey}.`);
    return {
        ...guide,
        id: `${courseId}:${lesson.id}:${platformKey}`,
        courseId, lessonId: lesson.id, platformKey, level,
        levelChallenge: level === 'beginner' ? 'Làm lần lượt các bước; dự đoán một kết quả trước mỗi lượt, ghi đầu vào và điều quan sát được.' : level === 'intermediate' ? 'Hoàn thành mẫu rồi chỉ đổi một tham số; thêm ca biên hoặc chuỗi sự kiện có thể làm sai dự đoán và giải thích kết quả.' : 'Chốt tiêu chí thành công trước khi chạy; tự thiết kế ít nhất ba ca gồm biên/lỗi, lưu cả lượt thất bại và giải thích giới hạn của nền tảng này.'
    };
}
