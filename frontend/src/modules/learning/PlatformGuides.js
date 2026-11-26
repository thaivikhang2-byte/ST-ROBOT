import {getArduinoGuide} from './guides/ArduinoGuides.js?v=lab-files-v2';
import {getLocalGuide} from './guides/LocalGuides.js';
import {getLabWorkflow} from './LabPlatformWorkflows.js?v=lab-files-v2';

// These are the choices in lab-platforms.js, not a claim of hardware compatibility.
const OFFERED = {
    arduino: ['circuit', 'avr', 'wokwi', 'phet', 'local'],
    microbit: ['python', 'local'],
    'vex-iq': ['gears', 'local'],
    'lego-spike': ['gears', 'local'],
    'vex-vr': ['gears', 'local']
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
        capability: 'Soạn và chạy MicroPython trên micro:bit mô phỏng; có thể tải chương trình cho bo thật.',
        setupSteps: [
            'Chọn micro:bit Python Editor và chờ hiện vùng viết mã cùng bo mô phỏng. Nếu đang có bài tự viết, lưu hoặc tải bản sao trước khi thay mẫu.',
            'Mở Mã mẫu của bài, chọn bản chương trình cần dùng và nạp vào editor. Kiểm tra dòng đầu có from microbit import *.',
            'Bấm Run trong editor. Dùng các nút A/B hoặc điều khiển cảm biến bên cạnh bo mô phỏng để làm bài.',
            ...(lesson.id === 'radio' ? ['Nếu simulator không có bảng gửi radio, chọn Bàn thí nghiệm trong bài để thử quy tắc nhận tin. Phần truyền radio thực tế cần hai bo micro:bit.'] : []),
            'Nếu editor không tải, bấm Mở tab riêng rồi dán mã vào https://python.microbit.org/v/3/. Bài sửa trong tab riêng cần tải tệp và lưu lại vào tài khoản ST-Robot.'
        ],
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

const GEARS_STEPS = {
    'vex-iq': {
        drive: [
            'Trong mẫu Python, giữ forward(200), WHEEL_DIAMETER_MM = 56 và SPEED = 25. Bấm Reset rồi Run.',
            'Ghi Requested distance, GPS displacement và góc hai bánh trong console. Làm ba lượt, Reset trước mỗi lượt.',
            'Đổi forward(200) thành forward(400), giữ nguyên robot và sân. Dự đoán quãng đường rồi chạy lại để so sánh.'
        ],
        turn: [
            'Giữ chuỗi forward(200) → turn_right(90) → forward(200). Đánh dấu vị trí và hướng xuất phát rồi bấm Reset → Run.',
            'Quan sát hai đoạn thẳng và lần quay giữa đường; ghi vị trí GPS cuối cùng và góc quay bánh được in trong console.',
            'Đổi turn_right(90) thành turn_right(45), Reset rồi chạy lại. So sánh hướng cuối và hình đường đi của hai lượt.'
        ],
        detect: [
            'Đặt một hộp trước cảm biến siêu âm của robot. Giữ THRESHOLD_CM = 20 và TIME_LIMIT_S = 10; bấm Reset → Run.',
            'Ghi khoảng cách cuối và lý do dừng trong console. Đối chiếu robot dừng vì obstacle_threshold hay hết time_limit.',
            'Đổi THRESHOLD_CM thành 30, đặt lại cùng sân và chạy lại. Sau đó bỏ hộp khỏi đường đi để kiểm tra lần dừng do hết thời gian.'
        ],
        mission: [
            'Giữ ROUTE_NAME = "A" và CELL_MM = 100. Dự đoán vị trí sau từng F/R/L, rồi bấm Reset → Run.',
            'Ghi trạng thái lưới cuối, GPS cuối và các chỗ va chạm nếu có. Đổi ROUTE_NAME thành "B", Reset và chạy từ cùng điểm đầu.',
            'Đối chiếu hai tuyến có cùng đến (3,2,nam) hay không. Ghi riêng kết quả tính trên lưới và kết quả chuyển động trên sân.'
        ],
        odometry: [
            'Giữ diameter_mm = 56, distance_mm = 500 và motor_turns_per_wheel_turn = 1. Tính trước số vòng bánh rồi chạy mẫu.',
            'Đọc wheel_turns, wheel_degrees và motor_turns trong console; kiểm tra đơn vị vòng và độ.',
            'Đổi đường kính thành 70 mm, giữ quãng đường 500 mm rồi chạy lại. Ghi vì sao bánh lớn cần ít vòng hơn cho cùng quãng đường.'
        ],
        control: [
            'Chạy mẫu wheel_commands(0, -10). Đọc hai lệnh bánh trong console và kiểm tra kết quả (25, 35).',
            'Đổi góc đo từ -10 thành 10 rồi chạy lại; kiểm tra hai lệnh đổi thành (35, 25).',
            'Giữ phép thử wrap_deg(179 - (-179)), đối chiếu kết quả -2°. Ghi vì sao sai số gần điểm ±180° phải được quy về góc ngắn nhất.'
        ]
    },
    'lego-spike': {
        mechanism: [
            'Chọn Cage Bot, giữ tay chắn ở vị trí đầu. Bấm Reset → Run và theo dõi ba mốc 0° → 30° → 0°.',
            'Ghi target_deg và measured_deg trong console sau mỗi mốc. Kiểm tra tay chắn trở về vị trí nghỉ.',
            'Đọc phép tính bộ truyền 12:36 ở cuối chương trình: motor 90° cho đầu ra -30°. Phân biệt phép tính này với góc tay chắn đang mô phỏng.'
        ],
        colors: [
            'Đặt hộp đỏ, xanh và vàng trên sân Cage Bot. Bấm Reset → Run rồi đưa từng hộp đến ngang cảm biến màu, cách siêu âm không quá 3 cm.',
            'Ghi nhãn màu, khoảng cách và nhóm A/B/CHECK được in. Lùi vật ra xa ít nhất 8 cm trước khi đưa hộp khác vào.',
            'Thử một hộp ở xa hoặc lệch mặt cảm biến. Ghi kết quả đọc được, kể cả CHECK, rồi so với vị trí đặt đúng.'
        ],
        sort: [
            'Bấm Reset → Run. Đưa một hộp đỏ vào vị trí đọc rồi giữ yên; theo dõi received và gate_cycles.',
            'Giữ hộp qua vài lần đọc để kiểm tra chỉ có một chu kỳ. Sau đó lùi vật ra ít nhất 8 cm và chờ đủ ba mẫu trống.',
            'Đưa hộp xanh vào. Ghi số vật đã nhận và chu kỳ tay chắn hoàn tất; đối chiếu với trường hợp giữ nguyên một vật.'
        ],
        project: [
            'Đọc danh sách expected_groups trong mẫu. Chuẩn bị thứ tự các hộp tương ứng trước khi bấm Reset → Run.',
            'Đưa từng hộp vào vùng đọc, chờ tay chắn hoàn tất rồi đưa vật ra. Ghi từng dòng RESULT, gồm lượt sai hoặc timeout.',
            'Đối chiếu planned, attempted và complete_test. Tính tỷ lệ với toàn bộ lượt đã thử, rồi ghi riêng nhận dạng màu và chu kỳ tay chắn.'
        ],
        ratio: [
            'Giữ teeth_in = 12, teeth_out = 36, speed_in_rpm = 90, torque_in_nm = 0.10 và efficiency = 0.80. Tính trước tốc độ và mô-men đầu ra rồi Run.',
            'Đọc speed_out_rpm và torque_out_nm trong console; đối chiếu -30 rpm và 0,24 N·m.',
            'Đổi số răng thành 36:12, chạy lại cùng tốc độ vào. Sau đó chỉ đổi efficiency thành 1 để xem riêng ảnh hưởng của hiệu suất.'
        ],
        state: [
            'Bấm Reset → Run, đưa hộp đỏ vào vùng đọc của Cage Bot. Ghi các trạng thái WAIT, CLASSIFY và WAIT_CLEAR xuất hiện trong console.',
            'Giữ hộp tại chỗ rồi đưa ra xa ít nhất 8 cm. Kiểm tra chương trình chỉ trở lại WAIT khi đã nhận đủ mẫu trống.',
            'Đưa hộp xanh vào để bắt đầu lượt kế tiếp. Lưu thứ tự sự kiện, trạng thái và bộ đếm; nếu có ERROR, ghi nguyên lý do trước khi Reset.'
        ]
    },
    'vex-vr': {
        sequence: [
            'Giữ chuỗi lệnh F F R F trong mẫu. Từ hướng đông, dự đoán vị trí và hướng sau bốn lệnh rồi bấm Reset → Run.',
            'Đọc từng dòng trạng thái lưới và GPS cuối trong console. Kiểm tra lệnh R chỉ đổi hướng, không tiến thêm một ô.',
            'Đổi chuỗi thành F R F L F, Reset rồi chạy lại. So sánh cả vị trí cuối lẫn hướng cuối của hai chuỗi.'
        ],
        loop: [
            'Giữ forward(200) và turn_right(90) bên trong vòng lặp bốn lần. Bấm Reset → Run rồi quan sát đường hình vuông.',
            'Đọc Return-position error trong console; ghi sai lệch vị trí cuối so với điểm xuất phát.',
            'Tạo bản sao mã, đưa lệnh rẽ ra ngoài vòng lặp rồi chạy từ cùng điểm đầu. Đối chiếu hình đường đi để xác định phạm vi vòng lặp.'
        ],
        avoid: [
            'Đặt vật cản trước robot, giữ THRESHOLD_CM = 20, TIME_LIMIT_S = 20 và MAX_ACTIONS = 40. Bấm Reset → Run.',
            'Ghi các quyết định tiến/rẽ và lý do dừng: goal_reached, time_limit hoặc action_limit.',
            'Đổi riêng THRESHOLD_CM thành 30 và chạy lại cùng sân. Thử thêm sân góc cụt để xem luật rẽ phải có tìm được lối ra hay không.'
        ],
        challenge: [
            'Chạy mẫu và đọc kết quả hai tuyến A/B với giá một bước tiến 1 s, một lần rẽ 3 s. Kiểm tra cả hai cùng tới (3,2).',
            'Ghi số bước tiến, số lần rẽ và tổng chi phí của từng tuyến; chọn tuyến có chi phí thấp hơn.',
            'Chạy bộ giá 2 s/0,2 s đã có trong mẫu. Đối chiếu tuyến được chọn có thay đổi không; thời gian ở đây là chi phí đặt trước.'
        ],
        search: [
            'Chạy mẫu BFS và đọc Path cùng Forward steps trong console. Kiểm tra đường bắt đầu ở START và kết thúc ở GOAL.',
            'Đổi WIDTH, HEIGHT thành 4, 3; đặt BLOCKED = {(1, 0), (1, 1)}, giữ START = (0, 0), GOAL = (3, 2). Chạy lại và kiểm tra đường có 5 bước.',
            'Thêm (1, 2) vào BLOCKED để tạo vách kín, chạy lại rồi ghi kết quả None. Bỏ tường vừa thêm để khôi phục đường đi.'
        ],
        experiment: [
            'Giữ ba bản đồ, FORWARD_S = 1, TURN_S = 0.5 và EXPANSION_LIMIT = 100. Chạy mẫu BFS và DFS.',
            'Ghi đủ sáu dòng kết quả của ba sân, kể cả no_path ở sân 3. Đối chiếu số ô mở rộng và chi phí của các tuyến tới đích.',
            'Đổi EXPANSION_LIMIT thành 2 rồi chạy lại. Phân biệt expansion_limit với no_path; giữ mẫu số ba sân khi tính tỷ lệ hoàn thành.'
        ]
    }
};

function gearsGuide(courseId, lesson) {
    const arithmetic = GEARS_MATH.includes(lesson.id);
    const cage = courseId === 'lego-spike' && !arithmetic;
    const setupSteps = arithmetic ? [
        'Mở GearsBot, chọn tab Python. Lưu dự án đang có trước khi thay mã của bài mới.',
        'Mở Mã mẫu của bài, sao chép toàn bộ chương trình vào vùng Python rồi mở console. Bài này tính toán trên dữ liệu, không cần cho robot di chuyển.'
    ] : cage ? [
        'Trong GearsBot, lưu dự án đang có rồi chọn Robot → Select Robot → Cage Bot; chuyển sang tab Python (ev3dev2).',
        'Với bài đọc màu, mở Worlds → World Builder và chuẩn bị các hộp đỏ, xanh, vàng. Đặt mặt hộp ngang cảm biến; giữ nguyên vị trí xuất phát giữa các lượt.',
        'Dán toàn bộ Mã mẫu của bài vào vùng Python và mở console. Tay chắn dùng outC, cảm biến màu in3 và siêu âm in4.',
        'Bấm Reset để đưa robot về mốc, rồi bấm Run. Dừng robot trước khi sửa mã hoặc bố trí lại sân.'
    ] : [
        'Trong GearsBot, lưu dự án đang có rồi chọn Robot → Select Robot → Single Sensor Line Follower; chuyển sang tab Python (ev3dev2).',
        'Chọn sân phẳng có đủ chỗ chạy; đánh dấu vị trí và hướng xuất phát. Robot mẫu dùng bánh 56 mm, khoảng cách hai bánh 152 mm.',
        'Dán toàn bộ Mã mẫu của bài vào vùng Python và mở console. Bánh trái A, bánh phải B, siêu âm INPUT_2, GPS INPUT_4.',
        'Bấm Reset rồi Run. Dùng cùng robot, sân và điểm xuất phát khi so hai lượt.'
    ];
    return {
        title: `${arithmetic ? 'GearsBot Python · tính toán' : 'GearsBot · thử robot'} · ${lesson.title}`,
        goal: lesson.goal, activityType: 'primary',
        capability: arithmetic ? 'Chạy Python và đọc kết quả tính toán trong console GearsBot.' : `Điều khiển robot 3D ${cage ? 'Cage Bot' : 'Single Sensor Line Follower'} bằng Python ev3dev2.`,
        setupSteps,
        steps: GEARS_STEPS[courseId][lesson.id],
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
    if (!guide) throw new RangeError(`Chưa có hướng dẫn ${courseId}/${lesson.id}/${platformKey}.`);
    const workflow = getLabWorkflow(platformKey);
    return {
        ...guide,
        saveSteps: workflow.saveSteps,
        reopenSteps: workflow.reopenSteps,
        finishCheck: guide.expected.slice(0, 2),
        id: `${courseId}:${lesson.id}:${platformKey}`,
        courseId, lessonId: lesson.id, platformKey, level,
        levelChallenge: level === 'beginner' ? 'Làm lần lượt từng bước. Ghi dự đoán trước khi chạy và kết quả sau mỗi lượt.' : level === 'intermediate' ? 'Hoàn thành mẫu, đổi một tham số rồi thử thêm một giá trị sát ngưỡng hoặc một trường hợp lỗi.' : 'Chọn tiêu chí trước khi chạy. Thiết kế ít nhất ba ca thử, giữ cả kết quả đạt và chưa đạt để giải thích.'
    };
}
