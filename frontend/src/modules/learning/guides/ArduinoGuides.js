const BLINK = `const unsigned long ON_MS = 200;
const unsigned long OFF_MS = 800;
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  digitalWrite(LED_BUILTIN, HIGH); delay(ON_MS);
  digitalWrite(LED_BUILTIN, LOW); delay(OFF_MS);
}
`;
const AVR_CODES = {
    led: `void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  digitalWrite(LED_BUILTIN, HIGH); delay(500);
  digitalWrite(LED_BUILTIN, LOW); delay(500);
}
`,
    timing: BLINK,
    distance: `// Test data, not readings from an HC-SR04.
const unsigned long echoUs[] = {1000, 2000, 0};
void pulse(unsigned long onMs) {
  digitalWrite(LED_BUILTIN, HIGH); delay(onMs);
  digitalWrite(LED_BUILTIN, LOW); delay(200);
}
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  for (byte i = 0; i < 3; ++i) {
    delay(2000);
    unsigned long t = echoUs[i];
    if (t == 0) {
      for (byte n = 0; n < 3; ++n) pulse(100); // error pattern
    } else {
      float cm = t * 0.034f / 2.0f;
      int groupsOf17cm = (int)(cm / 17.0f + 0.5f);
      for (int n = 0; n < groupsOf17cm; ++n) pulse(500);
    }
  }
}
`,
    alarm: `// Declared test data in cm; -1 means invalid, not a real distance.
const int samples[] = {19, 20, 21, -1};
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  for (byte i = 0; i < 4; ++i) {
    digitalWrite(LED_BUILTIN, LOW); delay(1000);
    int cm = samples[i];
    if (cm < 0) {
      for (byte n = 0; n < 3; ++n) {
        digitalWrite(LED_BUILTIN, HIGH); delay(100);
        digitalWrite(LED_BUILTIN, LOW); delay(100);
      }
      delay(2400);
    } else {
      digitalWrite(LED_BUILTIN, cm < 20 ? HIGH : LOW);
      delay(3000);
    }
  }
}
`,
    calibration: `// Numerical experiment. No sensor is read.
const float reference[] = {10, 20, 30};
const float measured[] = {11, 21, 31};
const float validation[] = {26.2f, 24.5f};
float offset = 0;
float absolute(float x) { return x < 0 ? -x : x; }
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  for (byte i = 0; i < 3; ++i) offset += measured[i] - reference[i];
  offset /= 3.0f;
}
void loop() {
  for (byte i = 0; i < 2; ++i) {
    digitalWrite(LED_BUILTIN, LOW); delay(1000);
    float before = absolute(validation[i] - 25.0f);
    float after = absolute(validation[i] - offset - 25.0f);
    digitalWrite(LED_BUILTIN, after < before ? HIGH : LOW);
    delay(3000); // lit only if this validation sample improves
  }
}
`,
    project: `// Test sequence in cm. -1 is a declared sensor error.
const int samples[] = {30, 19, 20, 22, -1, 25, 26};
bool alarm = false;
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  alarm = false; // each full test starts OFF
  for (byte i = 0; i < 7; ++i) {
    int cm = samples[i];
    if (cm < 0) {
      // Error indicator; do not change the stored alarm state.
      for (byte n = 0; n < 3; ++n) {
        digitalWrite(LED_BUILTIN, HIGH); delay(100);
        digitalWrite(LED_BUILTIN, LOW); delay(100);
      }
      digitalWrite(LED_BUILTIN, HIGH); delay(2400);
    } else {
      if (cm < 20) alarm = true;
      else if (cm > 25) alarm = false;
      digitalWrite(LED_BUILTIN, alarm ? HIGH : LOW); delay(3000);
    }
  }
  digitalWrite(LED_BUILTIN, LOW); delay(4000); // end-of-test gap
}
`
};

const AVR_ACTIVITIES = {
    led: {
        title: 'LED tích hợp và giới hạn của phép thử Blink',
        goal: 'Chạy Blink trên LED tích hợp rồi phân biệt nhịp đèn với việc đo dòng qua LED rời.',
        steps: ['Thay toàn bộ sketch trong AVR8js bằng mẫu LED. Chạy và đếm 10 chu kỳ sáng/tắt, mỗi trạng thái đặt 500 ms.', 'Đổi hai delay thành 250/750 rồi chạy lại; ghi nhịp và tỷ lệ bật.', 'Trở về Bàn thí nghiệm/CircuitJS để so dòng khi đổi điện trở 330/1000 Ω. AVR LED tích hợp không có phép thử đổi điện trở của bài này.'],
        expected: ['500/500 cho chu kỳ 1 s,250/750 vẫn 1 s nhưng tỷ lệ bật 25%.', 'Không suy dòng LED rời hoặc điện trở cần dùng từ độ sáng của LED tích hợp.'],
        evidence: ['Hai nhịp LED và bảng dòng từ nền tảng có điện trở; ghi rõ hai loại kết quả khác nhau.']
    },
    timing: {
        title: 'Điều khiển nhịp bằng Arduino C++',
        goal: 'Thay ON_MS/OFF_MS để tạo hai tần số cùng tỷ lệ bật và kiểm tra LED.',
        steps: ['Chạy mẫu ON_MS=200, OFF_MS=800; tính T=1000 ms, f=1 Hz, D=20% trước khi quan sát.', 'Đổi hằng số thành 250/750, chạy lại và đo nhiều chu kỳ; sau đó thử 125/375.', 'Ghi thời gian giả định trong sketch và quan sát. Tốc độ mô phỏng có thể khác đồng hồ thật; giải thích delay khiến lệnh tiếp theo phải chờ.'],
        expected: ['250/750:1 Hz,25%; 125/375:2 Hz,25%. Cùng tỷ lệ bật không là cùng nhịp.'],
        evidence: ['Bảng ba cặp thời gian/T/f/D, số chu kỳ quan sát và quy ước đo.']
    },
    distance: {
        title: 'Dữ liệu Echo giả định → tín hiệu LED',
        goal: 'Kiểm tra công thức khứ hồi và nhánh timeout bằng dữ liệu đã khai báo, không gắn cảm biến giả.',
        steps: ['Đọc echoUs={1000,2000,0}; dự đoán 17 cm,34 cm, lỗi. Mẫu không gọi pulseIn hay đọc HC-SR04.', 'Chạy: sau khoảng nghỉ 2 s, LED phát 1 xung dài cho 17 cm,2 xung dài cho 34 cm,3 xung ngắn cho lỗi.', 'Chỉ đổi echoUs[1] thành 3000 trong danh sách để dự đoán 51 cm/3 xung dài. Muốn đo khoảng cách từ vật, chuyển Wokwi và lắp HC-SR04 theo hướng dẫn của nền tảng đó.'],
        expected: ['1000/2000 µs được mã hóa thành 1/2 xung 500 ms; 0 dùng 3 xung 100 ms.', 'Đây là kiểm thử dữ liệu số, không là phép đo khoảng cách hoặc mô phỏng Echo phần cứng.'],
        evidence: ['Bảng Echo/d tính tay/số xung và ký hiệu riêng của lỗi.']
    },
    alarm: {
        title: 'Kiểm thử ba nhánh cảnh báo trên LED',
        goal: 'Thử ca 19/20/21 cm và lỗi với mảng giả định trong sketch LED.',
        steps: ['Đọc samples={19,20,21,-1}; −1 là ký hiệu lỗi của bộ thử. Dự đoán với điều kiện cm<20.', 'Chạy; mỗi mẫu có khoảng tắt 1 s rồi cửa sổ 3 s:19 sáng,20 tắt,21 tắt, lỗi chớp nhanh 3 lần.', 'Đổi riêng dấu<20 thành<=20 ở lệnh digitalWrite để kiểm tra ca 20; chạy lại từ đầu và ghi khác biệt. Không thay điều kiện lỗi cm<0.'],
        expected: ['19→gần,20/21→xa với dấu<; lỗi có mẫu nháy riêng.', 'Nhánh lỗi được đưa từ mảng, không tạo bằng rút cảm biến trong AVR8js LED.'],
        evidence: ['Bảng mẫu/chính sách/LED cho hai phép so sánh; phân biệt lỗi và xa.']
    },
    calibration: {
        title: 'Kiểm tra bù offset bằng LED báo đạt',
        goal: 'Tính offset từ ba cặp số rồi kiểm tra bù có giảm sai số của từng mẫu mới không.',
        steps: ['Tính offset từ reference 10/20/30 và measured 11/21/31:1 cm. Hai mẫu kiểm chứng ở chuẩn 25 là 26,2 và 24,5.', 'Chạy: LED sáng 3 s cho mẫu 26,2 vì sai số giảm 1,2→0,2; tắt 3 s cho 24,5 vì sai số tăng 0,5→1,5. Giữa mẫu có tắt 1 s.', 'Chỉ đổi validation[1] thành 25,8 trong danh sách: dự đoán bù thành 24,8 và sai số giảm 0,8→0,2 nên LED sáng. Ghi bảng tính vì bản LED không hiển thị số Serial.'],
        expected: ['Bù cùng offset có thể cải thiện mẫu này và làm xấu mẫu khác.', 'Không có số đo cảm biến mới trong mẫu; LED chỉ báo phép so sánh after<before.'],
        evidence: ['Bảng offset/giá trị trước-sau/sai số/LED cho hai mẫu và bản sửa.']
    },
    project: {
        title: 'Giữ trạng thái qua vùng hai ngưỡng',
        goal: 'Theo dõi trạng thái cảnh báo bằng dữ liệu 30,19,20,22, lỗi,25,26 và LED.',
        steps: ['Đọc samples và lập bảng trạng thái từ OFF: dưới 20 bật, trên 25 tắt, ở giữa giữ; lỗi không đổi biến alarm.', 'Chạy; mỗi mẫu 3 s, lỗi có 3 chớp nhanh rồi báo sáng. Hết chuỗi có khoảng tắt 4 s trước lượt thử mới từ OFF.', 'Đổi mẫu đầu 30 thành 22: từ OFF vẫn OFF. Đối chiếu 22 sau 19 giữ ON. Muốn thử cảm biến thật trong mô phỏng, chuyển Wokwi và dùng sketch HC-SR04 của bài.'],
        expected: ['Biến nhớ:OFF, ON, ON, ON, ON, ON, OFF; đầu ra lỗi có mẫu riêng.', 'Thử nghiệm kiểm tra logic từ mảng, không kiểm chứng chống nhiễu của cảm biến vật lý.'],
        evidence: ['Bảng mẫu/trạng thái trước-sau/LED và hai lần 22 với lịch sử khác nhau.']
    }
};

function avrGuide(lesson) {
    const activity = AVR_ACTIVITIES[lesson.id];
    return {
        ...activity,
        activityType: lesson.id === 'timing' ? 'primary' : 'related',
        capability: 'AVR8js đang mở là trang Arduino LED: sửa sketch Arduino C/C++ và chạy LED tích hợp. Cấu hình này không cung cấp HC-SR04 hay bảng mạch để lắp cảm biến; các mảng kiểm thử dưới đây là dữ liệu giả định.',
        setupSteps: ['Chọn AVR8js · Arduino LED; chờ trang tải. Tìm vùng sketch và nút Run/Stop của trang AVR8js.', 'Stop chương trình đang chạy, thay toàn bộ sketch bằng mẫu Arduino C++ của hoạt động này rồi Run. Nếu iframe không tải, mở https://www.falstad.com/circuit/avr 8js/ trong tab riêng.', 'Bắt đầu quan sát từ đầu mỗi lần Run; ghi các khoảng nghỉ/xung trong mẫu để không nhầm vị trí dữ liệu.'],
        troubleshooting: ['Không thấy đổi: kiểm tra đã thay sketch trong AVR8js và Run lại; mã trong khung ST-Robot không tự được nạp vào iframe này.', 'Không tìm thấy cảm biến: đây là bản LED. Dùng Wokwi nếu cần HC-SR04; không dán mẫu pulseIn của bài vào rồi coi là đang đo.', 'LED tắt ở hai mẫu liên tiếp: dùng các mốc thời gian của bộ thử; bảng dự đoán cần được viết trước khi Run.'],
        codeExamples: [{id: 'main', label: 'Arduino C++ · LED tích hợp', lang: 'Arduino C++', code: AVR_CODES[lesson.id], extension: 'ino'}],
        comparison: {mission: activity.goal, measurements: activity.evidence, limit: 'Chỉ so nhịp LED hoặc logic với cùng dữ liệu khai báo. AVR LED không xác nhận dòng LED rời, Echo cảm biến hay khoảng cách vật.'}
    };
}

const WOKWI_STEPS = {
    led: ['Chạy Blink, quan sát LED L trên Uno với 500 ms sáng/500 ms tắt. Không cần LED rời để chạy LED_BUILTIN.', 'Đổi hai delay thành 250/750 rồi chạy lại. Để làm đúng phần điện trở của bài, thêm LED rời và điện trở 330 Ω: D13→điện trở→anode A; cathode C→GND. Stop trước khi sửa dây.', 'Stop, đổi điện trở thành 1000 Ω và giữ dây/code. So trạng thái hoạt động; dùng CircuitJS hoặc mô hình mA để so dòng vì độ sáng hình Wokwi không phải ampe kế.'],
    timing: ['Chạy 200/800 ms rồi đo nhiều chu kỳ sáng. Tính T, f, D trước khi quan sát.', 'Stop, sửa delay thành 250/750; chạy lại. Tiếp tục 125/375 để tạo 2 Hz,25%.', 'Ghi cặp delay và số chu kỳ, không dùng một khung hình để kết luận duty cycle. Nếu cần phản hồi không chờ, giải thích lý do chuyển sang millis.'],
    distance: ['Run, mở Serial Monitor ở 9600 baud; nhấp HC-SR04 và thay Distance(cm) từ 10 lên 20 rồi 30. Ghi số in và đối chiếu đơn vị cm.', 'Dự đoán 10 cm tương ứng Echo khoảng 588 µs theo 0,034 cm/µs; mã dùng pulseIn có cửa sổ 30000 µs. Giá trị mô phỏng có thể sai khác nhỏ do làm tròn.', 'Thử timeout có chủ đích: Stop, ngắt riêng dây Echo cảm biến khỏi D10 và nối D10 qua điện trở 10 kΩ xuống GND; Run để nhận No echo. Stop rồi phục hồi dây Echo. Không coi thanh Distance luôn tạo được mất Echo.'],
    alarm: ['Run, mở Serial 9600; thử Distance 19,20,21 cm. Đọc NEAR/FAR và LED L; dấu<20 chỉ nhận 19 trong ba ca.', 'Stop, đổi ngưỡng 20.0f thành 30.0f, Run và thử 29/30/31. Chỉ đổi một quy tắc mỗi lượt.', 'Thử lỗi bằng cách Stop, ngắt Echo khỏi D10, kéo D10 xuống GND qua 10 kΩ rồi Run. SENSOR_ERROR làm LED sáng theo chính sách; phục hồi dây trước phép đo sau.'],
    calibration: ['Không cần HC-SR04: Run và mở Serial 9600 để đọc Offset cm:1.00, Corrected cm:25.20 từ dữ liệu đã khai báo.', 'Tính sai số tại chuẩn 25 cm: trước 1,2, sau 0,2. Điểm mới 26,2 không được dùng học offset.', 'Stop, đổi newMeasured thành 24.5f rồi chạy lại; corrected 23,5 có sai số 1,5, lớn hơn 0,5 trước bù. Đây là dữ liệu giả định, không tự thu mẫu từ sensor.'],
    project: ['Run từ đầu, lần lượt đặt Distance 30,19,20,22,25,26 cm; ghi ON/OFF và LED. Hai biên 20/25 giữ trạng thái trước.', 'Đặt 19 để alarm=ON rồi tạo timeout: Stop sẽ khởi động lại biến nên để kiểm tra giữ biến khi mất Echo mà không Reset cần dùng thao tác ngắt tín hiệu khi simulator hỗ trợ. Nếu không hỗ trợ đổi dây lúc chạy, dùng Bàn thí nghiệm/AVR với chuỗi lỗi để kiểm tra logic giữ biến và ghi rõ nguồn thử.', 'Có thể thử chính sách lỗi khởi động bằng Stop, ngắt Echo khỏi D10, kéo D10 qua 10 kΩ xuống GND rồi Run: console báo SENSOR_ERROR và LED sáng. Phép thử này không chứng minh giữ trạng thái từ lượt chạy trước.', 'Phục hồi dây, Run lại; so 22 từ OFF với 22 sau 19 từ ON. Giữ cả bảng lịch sử và kết quả lỗi, không chỉ ảnh LED.']
};

function wokwiGuide(lesson) {
    const sensor = ['distance', 'alarm', 'project'].includes(lesson.id);
    return {
        title: `Wokwi · ${lesson.title}`, goal: lesson.goal, activityType: 'primary',
        capability: 'Wokwi mô phỏng Arduino Uno và linh kiện số được lắp trong dự án. Khung nhúng là dự án mẫu; muốn thay sketch/wiring cần mở editor của dự án trong tab riêng. Không có cầu nối tự nạp mã từ ST-Robot sang Wokwi.',
        setupSteps: [
            'Chọn Wokwi trong Lab để chạy dự án mẫu. Chọn Mở tab riêng tới https://wokwi.com/projects/322062421191557714 để vào project editor. Nếu dự án chỉ đọc, tạo bản sao theo giao diện hoặc mở https://wokwi.com/projects/new/arduino-uno; tài khoản có thể cần khi lưu.',
            'Bấm Stop. Mở sketch.ino trong editor Wokwi, chọn toàn bộ và thay bằng đúng mẫu Arduino C++ của hoạt động này; không dán Python hoặc JSON vào sketch.ino.',
            ...(sensor ? ['Trong vùng sơ đồ, dùng nút + thêm HC-SR04 nếu chưa có. Nối VCC→5 V Uno, GND→GND, TRIG→D9, ECHO→D10. Đối chiếu từng nhãn chân; code của bài dùng đúng 9/10.', 'Mở Serial Monitor, chạy ở 9600 baud theo Serial.begin(9600). Nhấp cảm biến để thay khoảng cách; ghi giá trị đã đặt và số đọc riêng.'] : [lesson.id === 'calibration' ? 'Giữ Uno và mở Serial Monitor 9600 baud. Mẫu calibration chỉ xử lý mảng dữ liệu; không cần lắp cảm biến.' : 'Giữ Uno; LED_BUILTIN dùng LED L sẵn trên bo, không cần mắc LED rời cho sketch mẫu.']),
            'Run bằng nút Start Simulation của Wokwi. Chỉnh sửa trong tab riêng không tự đồng bộ về ST-Robot; lưu bản mã/dự án và ghi kết quả vào phần bằng chứng.'
        ],
        steps: WOKWI_STEPS[lesson.id],
        expected: lesson.id === 'calibration' ? ['Console in offset 1 cm và mẫu hiệu chỉnh 25,2 cm; đó là kết quả từ mảng, không phải thu cảm biến.'] : lesson.id === 'led' ? ['LED L sáng/tắt 500/500 ms; LED rời cần điện trở và đúng chiều. Độ sáng hình không cho số mA.'] : lesson.id === 'timing' ? ['200/800:1 Hz,20%; 250/750:1 Hz,25%; 125/375:2 Hz,25%.'] : lesson.id === 'distance' ? ['Số Serial xấp xỉ khoảng cách đã đặt; Echo lỗi in No echo, không in0 cm.'] : lesson.id === 'alarm' ? ['19 cm→NEAR/LED sáng,20/21→FAR/tắt; lỗi→SENSOR_ERROR/sáng.'] : ['Từ OFF,30/19/20/22/25/26→OFF/ON/ON/ON/ON/OFF; lỗi báo sáng nhưng không gán lại biến alarm.'],
        troubleshooting: ['Sketch chưa đổi trong iframe: mở tab editor, thay sketch.ino và Run ở đó; khung mã ST-Robot không điều khiển Wokwi.', 'Serial trống: mở monitor, kiểm tra Serial.begin(9600), code có in dữ liệu hay chỉ Blink; calibration chỉ in một lần lúc setup nên Stop/Run để xem lại.', 'No echo ngoài dự kiến: kiểm tra 5 V/GND, TRIG 9, ECHO 10 và đã phục hồi dây sau phép thử lỗi. Chân Echo ngắt không được để trôi khi cần timeout xác định.'],
        codeExamples: [{id: 'main', label: 'Arduino Uno · sketch.ino', lang: 'Arduino C++', code: lesson.code, extension: 'ino'}],
        evidence: ['Lưu sketch.ino và ảnh sơ đồ/giá trị điều khiển; bảng dự đoán–kết quả có đơn vị và ít nhất một ca biên/lỗi phù hợp hoạt động.'],
        comparison: {mission: `Kiểm tra ${lesson.title} bằng sketch Arduino và đối chiếu quy tắc ở Bàn thí nghiệm.`, measurements: lesson.id === 'led' ? ['So nhịp Blink riêng với bảng dòng 330/1000 Ω; không chuyển độ sáng hình thành mA.'] : lesson.id === 'calibration' ? ['Cùng ba điểm học offset và điểm mới: so offset, giá trị sau bù, sai số trước/sau.'] : sensor ? ['So cùng khoảng cách/ngưỡng/lịch sử trạng thái và nhánh lỗi. Ghi rõ mẫu nào là số đặt vào simulator, mẫu nào là tín hiệu Echo.'] : ['So on/off,T,f,D và ca đúng biên pha.'], limit: 'Mô phỏng không kiểm chứng dung sai linh kiện hay khoảng cách ngoài đời; Stop/Run khởi động lại biến, nên không dùng lượt mới để chứng minh giữ trạng thái của lượt trước.'}
    };
}

const ANALOG_ACTIVITIES = {
    circuit: {
        led: {
            title: 'LED và điện trở trong mạch analog', goal: 'So dòng qua LED khi chỉ đổi điện trở nối tiếp; quan sát cực tính và đường kín.',
            setupSteps: ['Chọn CircuitJS. Dùng File → New Blank Circuit để có trang trắng; trong Draw thêm nguồn DC hai cực 5 V, điện trở 330 Ω, LED và dây tạo vòng nguồn+→R→anode LED→cathode→nguồn −. Thêm Ground tại nguồn −.', 'Nhấp phải/Edit từng linh kiện để đặt giá trị. LED là linh kiện LED của CircuitJS, không phải bóng đèn. Chọn Run/Stop để chạy khi đã nối kín; rê chuột lên linh kiện để đọc dòng/điện áp.'],
            steps: ['Ghi dự đoán rồi đọc dòng LED ở 330 Ω. Stop, sửa riêng R thành 1000 Ω và Run; ghi dòng với đơn vị.', 'Trở về 330 Ω rồi thử mở một dây, chạy và ghi dòng. Khôi phục dây rồi đảo chiều LED để quan sát thay đổi.', 'Đối chiếu chiều thay đổi với mô hình cố định Vf=2 V của bàn bài học. Nếu số khác 9,09/3 mA, ghi Vf thực từ mô hình diode; không ép mô hình phi tuyến cho cùng con số.'],
            expected: ['Trong cùng mạch LED thuận, tăng R làm dòng giảm; mạch hở làm ngắt đường dòng.', 'CircuitJS dùng mô hình linh kiện; điện áp LED không bị cố định 2 V như bàn tính đơn giản.'],
            evidence: ['Sơ đồ với cực tính, bảng 330/1000 Ω, I, VLED và một phép thử mạch hở.']
        },
        timing: {
            title: 'Dạng sóng vuông và tỷ lệ bật', goal: 'Quan sát chu kỳ/tỷ lệ bật của nguồn vuông analog để liên hệ nhịp số.',
            setupSteps: ['Tạo mạch trắng CircuitJS. Thêm nguồn điện áp hai cực, điện trở 1 kΩ nối về nguồn và Ground ở cực âm; Edit nguồn, chọn Waveform=Square Wave.', 'Đặt Frequency=1 Hz, Max Voltage=2,5 V, DC Offset=2,5 V để hai mức 0/5 V; đặt Duty Cycle=20%. Nhấp phải nguồn và chọn View in Scope để xem dạng sóng.'],
            steps: ['Run và đọc thời gian một chu kỳ trên scope; ghi mức cao 0,2 s, mức thấp 0,8 s theo thiết lập.', 'Giữ 1 Hz, đổi Duty Cycle=25%; tiếp theo đổi Frequency=2 Hz và giữ 25%.', 'Dùng nhãn trục thời gian của scope để đối chiếu T=1/f; đây là nguồn sóng, không thực thi delay của Uno.'],
            expected: ['1 Hz/25% có T 1 s, cao 0,25 s; 2 Hz/25% có T 0,5 s, cao 0,125 s.'],
            evidence: ['Ảnh scope kèm trục/thiết lập f, D và bảng t_on/t_off.']
        },
        distance: {
            title: 'Phép chia hai trong một mạch chia áp', goal: 'Khảo sát tỷ số 1/2 như hoạt động liên hệ phép đo khứ hồi, không giả lập HC-SR04.',
            setupSteps: ['Tạo mạch DC CircuitJS:nguồn 1 V→R1=1 kΩ→điểm giữa→R2=1 kΩ→nguồn −; Ground ở nguồn −.', 'Rê chuột điểm giữa để đọc điện áp so Ground; giữ hai điện trở bằng nhau. Không có Arduino hay Echo trong mạch này.'],
            steps: ['Ghi Vin 1 V, Vout khoảng 0,5 V. Chỉ đổi nguồn thành 2 V, ghi Vout khoảng 1 V.', 'Từ số Echo 1000/2000 µs của đề, tính riêng tổng đường âm 34/68 cm rồi chia 2 thành 17/34 cm.', 'So tỷ sốVout/Vin=1/2 với bước chia 2 của đường khứ hồi; nêu rõ mạch không biến điện áp thành cm và không đo thời gian siêu âm.'],
            expected: ['Hai điện trở bằng nhau cho Vout≈Vin/2; phép chia 2 có thể so về tỷ số, không so đại lượng vật lý.', 'Không có kết quả No echo trong phép thử DC.'],
            evidence: ['Bảng Vin/Vout và bảng Echo/tổng đường/khoảng cách một chiều, ghi đơn vị riêng.']
        },
        alarm: {
            title: 'Đầu ra đèn theo bảng quyết định thủ công', goal: 'Kiểm tra cách hiển thị ba nhánh gần/xa/lỗi bằng công tắc, không chạy thuật toán Arduino.',
            setupSteps: ['Tạo mạch 5 V→công tắc→điện trở 330 Ω→LED→Ground và đường về nguồn. Chạy thử đóng/mở công tắc để xác nhận LED sáng/tắt.', 'Chuẩn bị bảng mẫu 19,20,21 cm và lỗi; CircuitJS mạch này không có HC-SR04. Người học sẽ thực hiện quyết định thủ công.'],
            steps: ['Với điều kiện d<20, đọc từng dòng 19/20/21 và tự đóng công tắc chỉ ở 19. Ghi nhánh và dòng LED.', 'Ở dòng lỗi, đóng công tắc theo chính sách báo lỗi; sáng không cho biết đó là NEAR hay ERROR nên bổ sung nhãn trên bảng.', 'Đổi luật thànhd<=20 rồi làm lại dòng 20; so thay đổi đầu ra khi chỉ đổi dấu.'],
            expected: ['19 và lỗi có thể cùng làm đèn sáng nhưng mang nghĩa khác nhau; 20 chỉ sáng khi dùng<=.', 'Công tắc do bạn bấm; mạch không tự đọc khoảng cách hoặc thực thi if.'],
            evidence: ['Bảng d/tính hợp lệ/dấu/nhánh/công tắc/I_LED với nhãn lỗi riêng.']
        },
        calibration: {
            title: 'Đối chiếu lệch của dữ liệu điện áp', goal: 'Ước lượng một offset cố định từ dữ liệu giả định rồi kiểm chứng điểm mới.',
            setupSteps: ['Tạo CircuitJS nguồnDC nối điện trở 1 kΩ với Ground để đọc điện áp nguồn. Chuẩn bị ba chuẩn 1/2/3 V và ba giá trị đo giả định 1,1/2,1/3,1 V.', 'Các giá trị đo do bạn đặt nguồn, mô phỏng một bảng số liệu có lệch; đây không phải sai số tự sinh của đồng hồ CircuitJS.'],
            steps: ['Lần lượt Edit nguồn thành 1,1; 2,1; 3,1 V và đọc lại nhãn. Tính đo −chuẩn=0,1 V ở mỗi hàng, offset trung bình 0,1 V.', 'Dùng điểm mới chuẩn 2,5 V, đo giả định 2,62 V:trừ offset được 2,52 V; sai số 0,12→0,02 V.', 'Thử điểm mới 2,45 V tại cùng chuẩn:bù thành 2,35 V, làm sai số tăng. Liên hệ tương tự bảng cm của bài nhưng không đổi V thành cm.'],
            expected: ['Offset cùng đơn vị với dữ liệu; điểm kiểm chứng tách khỏi điểm học.', 'Một offset không bảo đảm cải thiện mọi mẫu.'],
            evidence: ['Bảng chuẩn/đo giả định/offset và hai điểm mới có sai số trước-sau bằng V.']
        },
        project: {
            title: 'Công tắc giữ trạng thái theo hai ngưỡng', goal: 'Diễn lại bảng trạng thái có lịch sử và tách báo lỗi khỏi trạng thái nhớ.',
            setupSteps: ['Tạo mạch CircuitJS 5 V→công tắc→330 Ω→LED→Ground và đường về nguồn; đặt công tắc mở làm OFF ban đầu.', 'Viết hai cột alarm nhớ và trạng thái LED. Chuẩn bị chuỗi 30,19,20,22, X,25,26 cm; X là dữ liệu lỗi trên giấy.'],
            steps: ['Đi từng mẫu; chỉ đóng khi<20, mở khi>25, giữ khi 20..25. Ghi trạng thái trước/sau trước khi bấm công tắc.', 'Ở X, giữ giá trị alarm trên giấy nhưng đóng công tắc báo lỗi; ở mẫu hợp lệ tiếp theo đặt đèn theo alarm.', 'Khởi động OFF và thử 22; so 22 sau 19. Công tắc không tự nhớ thuật toán:người học đang thực hiện máy trạng thái bằng tay.'],
            expected: ['Biến nhớ trên giấy:OFF, ON, ON, ON, ON, ON, OFF; đèn báo lỗi có nghĩa riêng.', 'Hai mẫu 22 có thể khác đầu ra vì lịch sử, không vì đổi ngưỡng.'],
            evidence: ['Trace đầy đủ với công tắc, alarm nhớ, LED và hai lịch sử của 22.']
        }
    },
    phet: {
        led: {
            title: 'Mạch kín với bóng đèn và điện trở', goal: 'So dòng trong mạch DC khi đổi điện trở bằng bóng đèn thay LED.',
            steps: ['Trong màn hình Lab, kéo pin, bóng đèn, điện trở và dây thành vòng kín; dùng công cụ ampe kế của PhET để đọc dòng.', 'Chọn điện trở và đặt hai giá trị khác nhau trong miền PhET cho phép, giữ cùng pin/bóng; ghi giá trị thực đã dùng và dòng mỗi lượt.', 'Ngắt một dây rồi nối lại; quan sát dòng 0 khi hở. Bóng đèn PhET không có cực tính của LED nên không dùng thí nghiệm này kết luận chiềuLED hoặcVf=2 V.'],
            expected: ['Cùng pin/bóng, tăng điện trở nối tiếp làm dòng giảm; mạch hở không có dòng duy trì.', 'Bóng đèn là tải thay thế, không chứng minh điện trở 330 Ω của LED thực có dòng 9,09 mA.'],
            evidence: ['Ảnh mạch, bảngR thực có/I và kết quả mạch hở.']
        },
        timing: {
            title: 'Nhịp đóng/mở công tắc đo bằng đồng hồ', goal: 'Tách chu kỳ và tỷ lệ bật bằng thao tác thủ công chậm.',
            steps: ['Lắp pin, công tắc, bóng đèn thành mạch kín. Chuẩn bị đồng hồ:đóng 2 s, mở 8 s, lặp 3 chu kỳ và ghi tổng thời gian.', 'Đổi thànhđóng 5 s/mở 5 s:giữ chu kỳ 10 s nhưng tăng tỷ lệ bật 20%→50%.', 'Thử 1 s/4 s để giữ 20% và tăng tần số 0,1→0,2 Hz. Ghi sai số thao tác tay; PhET không thực thi delay Arduino.'],
            expected: ['2/8 và5/5 cùngT10 s,khácD;1/4 cóT5 s,D20%.', 'Không thể đo chính xác 200 ms bằng cách bấm tay rồi gọi là kiểm thử sketch.'],
            evidence: ['Bảng khoảng đóng/mở dự định và thời gian tay đo, ít nhất 3 chu kỳ.']
        },
        distance: {
            title: 'Tỷ số một nửa bằng hai điện trở', goal: 'Liên hệ phép chia 2 qua mạch chia áp, không đo siêu âm.',
            steps: ['Lắp pin vàhai điện trở bằng nhau nối tiếp; dùng vôn kế đo toàn pin rồi điện áp trên một điện trở.', 'Ghi điện áp từng phần xấp xỉmột nửa tổng. Đổi cả hai điện trở sang cùng một giá trị mới, giữ tỷ số 1:1 rồi đo lại.', 'Lập riêng bảngEcho 1000/2000 µs→tổng đường 34/68 cm→một chiều 17/34 cm. So tỷ số 1/2, không đổi volt thành cm và không nói PhET có HC-SR04.'],
            expected: ['Điện áp trên mỗiR bằng nhau xấp xỉVpin/2 trong mạch nối tiếp lý tưởng.', 'PhET không tạo/đọc xungEcho hoặc timeout của bộ cảm biến.'],
            evidence: ['BảngVpin/VtrênR và bảngEcho/d riêng đơn vị, một câu giải thích giới hạn liên hệ.']
        },
        alarm: {
            title: 'Công tắc theo bảng ba nhánh', goal: 'Thực hành quyết định gần/xa/lỗi trước khi tự động hóa.',
            steps: ['Lắp pin, công tắc, bóng đèn. Viết các hàng 19,20,21 cm vàlỗi; dùng luật d<20.', 'Tự đóng công tắc ở 19, mở ở 20/21, đóng khi lỗi theo chính sách báo lỗi; ghi nhánh bên cạnh ảnh bóng.', 'Đổi dấu sang<= rồi làm lại ca 20. Chỉ ra rằng bóng sáng không phân biệt gần vàlỗi, nên báo cáo cần nhãn trạng thái.'],
            expected: ['Dấu< chỉ nhận 19 trong ba ca; dấu<= nhận cả 20.', 'PhET chỉ phản ánh công tắc bạn bấm; không tự đọc khoảng cách hay chạy ifArduino.'],
            evidence: ['Bảng mẫu/nhánh/công tắc/bóng có ca biên vàlỗi.']
        },
        calibration: {
            title: 'Kiểm chứng offset bằng bộ dữ liệu điện áp', goal: 'Tập phân biệt giá trị chuẩn, giá trị đo giả định vàđiểm kiểm chứng.',
            steps: ['Lắp pin vàđiện trở thành mạch kín; đặt pin 9 V, dùng vôn kế đo hai đầu pin để luyện cách đọc đúng đơn vị.', 'Trên giấy dùng ba chuẩn 2/4/6 V vàđo giả định 2,2/4,2/6,2 V:tính offset 0,2 V. Đây là dữ liệu do đề cho, không nói vôn kế PhET tự sinh lệch này.', 'Ở chuẩn 5 V, kiểm chứngđo 5,3 V→bù 5,1 V:sai số 0,3→0,1 V. Thửđo 4,9 V→4,7 V để thấy bù có thể làm xấu hơn; giữ điểm mới tách khỏi dữ liệu học.'],
            expected: ['Đọc điện áp có đơn vị; offset 0,2 V chỉ thuộc bộ dữ liệu giả định.', 'Không suy PhET mô phỏng sai số củaHC-SR04 hoặc chuyểnV thànhcm.'],
            evidence: ['Ảnh đọcV, bảng số liệu giả định vàhai điểm kiểm chứng trước-sau bù.']
        },
        project: {
            title: 'Bóng đèn với quy tắc có bộ nhớ', goal: 'Tự diễn lại hai ngưỡng vàchính sách lỗi để hiểu lịch sử trạng thái.',
            steps: ['Lắp pin, công tắc, bóng đèn. Khởi đầu công tắc mở, alarm nhớOFF trên giấy; chuỗi 30,19,20,22, X,25,26.', 'Ở mỗi mẫu, dùng<20 bật,>25 tắt, giữa hai ngưỡng giữ. X chỉ làm đèn báo lỗi sáng, không sửa giá trị nhớ trên giấy.', 'Khởi đầuOFF vàthử 22 rồiso với 22 sau 19. Ghi rõ người học đang thay công tắc, không phải chương trình tự điều khiển.'],
            expected: ['Trạng thái nhớOFF, ON, ON, ON, ON, ON, OFF; biên 20/25 giữ trạng thái cũ.', 'PhET không cóHC-SR04 hoặc bộ nhớ alarm tự động trong mạch này.'],
            evidence: ['Bảng mẫu/trạng thái nhớ trước-sau/công tắc, báo lỗi vàhai lịch sử của 22.']
        }
    }
};

function analogGuide(lesson, platformKey) {
    const activity = ANALOG_ACTIVITIES[platformKey][lesson.id];
    const phet = platformKey === 'phet';
    return {
        ...activity,
        activityType: !phet && lesson.id === 'led' ? 'primary' : 'related',
        capability: phet ? 'PhET Circuit Construction Kit DC là thí nghiệm mạch DC với pin, dây, điện trở, bóng đèn, công tắc vàdụng cụ đo. Hoạt động này không có Arduino, HC-SR04, LED bán dẫn hay trình thực thi mã.' : 'CircuitJS mô phỏng mạch analog vàdạng sóng. Hoạt động này không chạy sketch Arduino; chỉ bàiLED khảo sát trực tiếp mạchLED, các bài khác dùng mô hình điện hoặc thao tác tay để liên hệ khái niệm.',
        setupSteps: activity.setupSteps || ['Chọn PhET · Mạch điện DC; vào màn hình Lab để kéo linh kiện. Dùng dây nối kín hai cực pin qua tải, công tắc vàđặt công cụ đo theo nhãn của mô phỏng.', 'Dùng nút Reset All nếu còn mạch cũ. Nếu iframe không tải, hãy Mở tab riêng từ Lab; chỉnh sửa mạch ở đó vàlưu ảnh kết quả.'],
        troubleshooting: phet ? ['Bóng không sáng:kiểm tra vòng dây kín, hai đầu dây khớp đầu nối linh kiện vàcông tắc đã đóng.', 'Không có linh kiện/giá trị Arduino:đây là mạchDC. Chọn Wokwi để chạy C++ vàHC-SR04; dùng giá trị điện trở PhET thực sự cho chọn, ghi giá trị đó.', 'Vôn kế đọc 0:đặt hai que ở hai điểm khác điện thế; ampe kế phải theo công cụ dòng điện củaPhET.'] : ['Không có dòng:kiểm tra đầu dây nối đúng nút, mạch có đường về nguồn vàcó Ground để tham chiếu.', 'Dòng khác bàn tínhVf 2 V:đọc điện ápLED củaCircuitJS, mô hình diode có thể phi tuyến; chỉ so khi cùng giả thiết.', 'Không thấy code editorArduino là đúng:CircuitJS hoạt động bằng linh kiện. Dán C++ vào nguồn điện áp không thực thi được.'],
        codeExamples: [],
        comparison: {mission: activity.goal, measurements: activity.evidence, limit: phet ? 'So quy tắc, tỷ số hoặc dữ liệu theo đơn vị ghi rõ; PhET không thực hiện chương trình Arduino hay đo siêu âm.' : lesson.id === 'led' ? 'So chiều thay đổi dòng khi tăngR; ghi khác biệt mô hìnhLED phi tuyến vớiVf cố định củaBàn thí nghiệm.' : 'So quan hệ được nêu trong hoạt động; nguồn áp/công tắc thao tác tay không thay cho cảm biến hoặc chương trình Arduino.'}
    };
}

export function getArduinoGuide(lesson, platformKey) {
    if (platformKey === 'wokwi') return wokwiGuide(lesson);
    if (platformKey === 'avr') return avrGuide(lesson);
    if (['circuit', 'phet'].includes(platformKey)) return analogGuide(lesson, platformKey);
    throw new RangeError(`Nền tảng Arduino không hỗ trợ: ${platformKey}`);
}
