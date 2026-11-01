/* Provider entry points and documented embed routes. See docs/lab-platforms.md.
   Editor links stay separate from embedded players/simulators. */
window.STROBOT_LAB_PLATFORMS = {
    circuit: {
        name: 'CircuitJS · Mạch điện', mode: 'embed', languages: 'Mô phỏng mạch analog',
        url: 'https://www.falstad.com/circuit/circuitjs.html',
        sourceUrl: 'https://www.falstad.com/circuit/',
        note: 'Thay linh kiện và quan sát điện áp, dòng điện. CircuitJS không chạy chương trình Arduino và không mô phỏng đầy đủ cảm biến HC-SR04.',
        guides: { arduino: 'Dựng mạch nguồn – điện trở – LED. So sánh dòng điện ở 220 Ω, 330 Ω và 1 kΩ; đối chiếu với I = (Vs − Vf)/R. Ngắt nguồn trước khi sửa mạch thật.' }
    },
    avr: {
        name: 'AVR8js · Arduino LED', mode: 'embed', languages: 'Arduino C/C++ · AVR',
        url: 'https://www.falstad.com/circuit/avr8js/',
        sourceUrl: 'https://github.com/wokwi/avr8js',
        note: 'Demo Arduino kết hợp CircuitJS, phù hợp thử chương trình LED. Biên dịch cần Internet; không phải mọi thư viện hoặc cảm biến Arduino đều được hỗ trợ.',
        guides: { arduino: 'Chạy ví dụ Blink có sẵn, thay thời gian HIGH/LOW rồi đo chu kỳ. Đối chiếu nhịp chớp với bài tín hiệu số; không coi demo LED là mô hình đầy đủ của HC-SR04.' }
    },
    wokwi: {
        name: 'Wokwi · Arduino Uno', mode: 'embed', languages: 'Arduino C/C++ · mô phỏng số',
        url: 'https://wokwi.com/projects/322062421191557714',
        embedUrl: 'https://wokwi.com/share/embed/322062421191557714',
        sourceUrl: 'https://docs.wokwi.com/',
        note: 'Dự án Arduino Uno mẫu từ hướng dẫn Wokwi. Dùng nút mở riêng để sửa code, thêm linh kiện hoặc tạo bản sao; lưu trữ và một số tính năng có thể cần tài khoản.',
        guides: { arduino: 'Mở mẫu Uno, thử Blink rồi tạo bản sao để lắp HC-SR04 và cảnh báo ngưỡng theo bài. Kiểm tra sơ đồ chân trước khi chạy; mô phỏng không thay thế việc kiểm tra điện áp và dây nối của kit thật.' }
    },
    phet: {
        name: 'PhET · Mạch điện DC', mode: 'embed', languages: 'Thí nghiệm điện trực quan',
        url: 'https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc',
        embedUrl: 'https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html',
        sourceUrl: 'https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc',
        note: 'Bộ thí nghiệm mạch DC của University of Colorado Boulder. Dùng để hiểu mạch kín, dòng điện và đo điện áp; không có trình biên dịch Arduino.',
        guides: { arduino: 'Chọn linh kiện điện trở, nguồn và dây nối. Mắc ampe kế nối tiếp, vôn kế song song; ghi V và I rồi so sánh R = V/I. Điện trở trong mô hình khác LED thật nên không dùng thay datasheet LED.' }
    },
    makecode: {
        name: 'MakeCode · micro:bit', mode: 'embed', languages: 'Blocks · JavaScript · MakeCode Python',
        url: 'https://makecode.microbit.org/#editor',
        sourceUrl: 'https://makecode.microbit.org/docs',
        note: 'Trình soạn thảo kèm simulator micro:bit. MakeCode Python và MicroPython là hai môi trường khác nhau; không dán nguyên API của môi trường này sang môi trường kia.',
        guides: { microbit: 'Tạo New Project, thử hiển thị LED và sự kiện nút A/B. Với radio, dùng nhiều simulator nếu nền tảng hỗ trợ; ghi nhóm, loại thông điệp và cách tránh đếm lặp trước khi thử trên board.' }
    },
    micropython: {
        name: 'Python Editor · micro:bit', mode: 'external', languages: 'MicroPython · simulator micro:bit',
        url: 'https://python.microbit.org/v/3',
        sourceUrl: 'https://python.microbit.org/',
        note: 'Python Editor chính thức của micro:bit có simulator. Phù hợp các ví dụ dùng from microbit import *; một số tính năng và cảm biến chỉ có trên board tương ứng.',
        externalNote: 'Mở Python Editor ở tab riêng để viết và chạy MicroPython. ST-Robot không nhúng trình soạn thảo này khi chưa có cách nhúng được tài liệu hóa.',
        guides: { microbit: 'Chọn bản mã “MicroPython · Python Editor” trong bài, chép sang editor và thử nút/ánh sáng. Phân biệt was_pressed() với is_pressed(); thử trên board thật khi bài cần đo tín hiệu hoặc radio thực tế.' }
    },
    arcade: {
        name: 'MakeCode Arcade · Trò chơi', mode: 'embed', languages: 'Blocks · TypeScript · game simulator',
        url: 'https://arcade.makecode.com/#pub:_1yfTMtFAe5yC',
        embedUrl: 'https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC',
        sourceUrl: 'https://arcade.makecode.com/share',
        note: 'Chạy mẫu Monster Truck Racer trong khung; mở riêng để xem/sửa bản sao bằng Blocks hoặc TypeScript. Đây là trò chơi luyện thuật toán, không phải simulator của board micro:bit hay robot VEX/LEGO.',
        guides: {
            microbit: 'Quan sát các nút điều khiển và biến trạng thái trong trò chơi. Mở bản sao, thay điều kiện hoặc bộ đếm rồi so sánh với sự kiện A/B ở bài micro:bit; API game khác API micro:bit.',
            'vex-iq': 'Dùng trò chơi để luyện sự kiện, vòng lặp và điều kiện dừng. Ghi quy tắc chuyển trạng thái rồi chuyển ý tưởng sang pseudocode robot; không quy đổi trực tiếp pixel trong game thành milimét trên VEX IQ.',
            'vex-vr': 'Luyện chuỗi lệnh, điều kiện và kiểm thử hai chiến lược điều khiển trong game. Phân biệt tọa độ pixel của trò chơi với tọa độ sa bàn và đơn vị quãng đường của robot VR.'
        }
    },
    scratch: {
        name: 'Scratch · Mê cung', mode: 'embed', languages: 'Khối lệnh · chạy dự án mẫu',
        url: 'https://scratch.mit.edu/projects/10128431/editor/',
        embedUrl: 'https://scratch.mit.edu/projects/10128431/embed',
        sourceUrl: 'https://scratch.mit.edu/ideas',
        note: 'Mẫu Maze Starter được Scratch giới thiệu. Khung nhúng chạy dự án; nút mở riêng đưa đến trình soạn thảo để sửa hoặc remix. Mê cung 2D không mô phỏng động cơ, cảm biến hay kit robot thật.',
        guides: {
            microbit: 'Nhấn cờ xanh và thử các phím điều khiển. Trong editor, tìm vòng lặp, sự kiện và biến đếm; so sánh xử lý phím với nút A/B của board, tránh tăng biến liên tục khi giữ nút.',
            'vex-iq': 'Luyện mô tả đường đi và điều kiện gặp tường bằng khối lệnh. Dự đoán vị trí trước khi chạy; thuật toán có thể chuyển ý tưởng sang robot nhưng khối lệnh Scratch không điều khiển VEX IQ trực tiếp.',
            'lego-spike': 'Dùng nhân vật và các tín hiệu để diễn đạt các trạng thái chờ – phát hiện – xử lý. Chỉ tăng bộ đếm khi chuyển trạng thái; bài mê cung không thay cho mô phỏng cơ cấu LEGO.',
            'vex-vr': 'Mô tả mê cung bằng các ô, thử đường đi rồi đối chiếu điều kiện tránh tường. Scratch là môi trường luyện tư duy; để dùng lệnh VEXcode VR, mở nền tảng VEXcode VR chính thức.'
        }
    },
    gears: {
        name: 'GearsBot · Robot 3D', mode: 'embed', languages: 'Blockly · Python · robot ảo',
        url: 'https://gears.aposteriori.com.sg/',
        sourceUrl: 'https://github.com/QuirkyCort/gears',
        note: 'Robot giáo dục 3D để luyện thuật toán, cảm biến và sa bàn. Không phải trình giả lập chính hãng VEX IQ, VEXcode VR hoặc LEGO SPIKE; cấu hình và API khác với kit thật.',
        guides: {
            'vex-iq': 'Chọn robot hai bánh và thế giới có tường. Đo đường kính bánh trong mô hình, thử di chuyển/quay rồi hiệu chuẩn sai số; viết lại thuật toán với API phù hợp thay vì dán nguyên mã VEX IQ.',
            'lego-spike': 'Chọn robot có cảm biến phù hợp để quan sát điều kiện và vòng lặp. Cơ cấu phân loại cần mô hình tương ứng; khi không có cơ cấu đó, dùng bàn thí nghiệm nội bộ để kiểm tra tỉ số truyền và trạng thái.',
            'vex-vr': 'Chọn sa bàn, thử chuỗi lệnh và điều kiện tránh tường. Ghi hệ tọa độ và đơn vị đang dùng; robot và nhiệm vụ của GearsBot khác VEXcode VR nên không so sánh điểm trực tiếp.'
        }
    },
    openroberta: {
        name: 'Open Roberta Lab', mode: 'external', languages: 'NEPO Blocks · robot và simulator',
        url: 'https://lab.open-roberta.org/',
        sourceUrl: 'https://github.com/OpenRoberta/openroberta-lab',
        note: 'Môi trường NEPO cho nhiều hệ robot. Chọn đúng robot và kiểm tra simulator được cung cấp; không phải cấu hình robot nào cũng hỗ trợ mọi cảm biến hoặc chạy mô phỏng.',
        externalNote: 'Mở Open Roberta ở tab riêng để chọn robot, lập trình và xem simulator. Việc hỗ trợ kit/cảm biến phụ thuộc cấu hình nền tảng bạn chọn.',
        guides: {
            'vex-iq': 'Chọn robot mô phỏng có truyền động vi sai để luyện thứ tự lệnh và phản hồi. Đây là môi trường chuyển giao thuật toán, không chạy nguyên lệnh VEX IQ.',
            'lego-spike': 'Kiểm tra danh sách robot và tùy chọn SPIKE/Pybricks đang được nền tảng cung cấp. Nếu không có simulator cho cấu hình của bạn, thực hành logic trên robot ảo khác hoặc dùng bàn thí nghiệm ST-Robot.',
            'vex-vr': 'Tạo chương trình NEPO cho robot mô phỏng: chạy, quay và dừng theo cảm biến. So sánh thuật toán với bài VR; tên API, tọa độ và sa bàn của hai môi trường không giống nhau.'
        }
    },
    vexiq: {
        name: 'VEXcode IQ · Chính thức', mode: 'external', languages: 'VEX Blocks · Python/C++ tùy cấu hình',
        url: 'https://codeiq.vex.com/',
        sourceUrl: 'https://api.vex.com/iq2/home/',
        note: 'Trình soạn thảo chính thức dành cho VEX IQ. Chọn đúng thế hệ Brain và cấu hình cổng; việc chạy trên kit cần phần cứng thật, không phải mọi dự án đều có simulator.',
        guides: { 'vex-iq': 'Đối chiếu pseudocode với lệnh của đúng thế hệ VEX IQ, khai báo động cơ/cảm biến và đơn vị. Ngắt nguồn khi đổi dây; kiểm thử tốc độ thấp trước khi chạy nhiệm vụ trên sa bàn.' }
    },
    spike: {
        name: 'LEGO Education SPIKE', mode: 'external', languages: 'Word Blocks · Python theo app',
        url: 'https://spike.legoeducation.com/',
        sourceUrl: 'https://education.lego.com/en-us/downloads/spike-app/software/',
        note: 'Ứng dụng chính thức cho kit LEGO Education SPIKE. Chọn đúng hub/phiên bản API; ứng dụng không phải phòng mô phỏng đầy đủ cơ cấu SPIKE khi không có phần cứng.',
        guides: { 'lego-spike': 'Chọn SPIKE Prime, khai báo cổng rồi chuyển pseudocode thành lệnh của app hiện hành. Kiểm tra chiều quay, dừng an toàn và tránh kẹp tay ở bánh răng trước khi thử cơ cấu thật.' }
    },
    vexvr: {
        name: 'VEXcode VR · Chính thức', mode: 'external', languages: 'VEX Blocks · Python tùy cấp truy cập',
        url: 'https://vr.vex.com/',
        sourceUrl: 'https://vr.vex.com/',
        note: 'Robot ảo và playground chính thức của VEXcode VR. Một số playground, ngôn ngữ hoặc tính năng có thể phụ thuộc cấp truy cập; dùng nội dung sẵn có và không cần mua thêm để học lý thuyết ST-Robot.',
        guides: { 'vex-vr': 'Chọn playground phù hợp, chạy chương trình đơn giản rồi thêm vòng lặp/cảm biến. Với bài BFS, dùng mô hình lưới của bài để lập kế hoạch; khả năng truy cập bản đồ phụ thuộc playground và API đang dùng.' }
    },
    local: {
        name: 'Bàn thí nghiệm trong bài', mode: 'local', languages: 'Mô hình tương tác · không cần mạng',
        note: 'Thử trực tiếp các tham số và quan sát kết quả của mô hình trong bài học. Ghi cả dự đoán, kết quả và giới hạn mô hình vào nhật ký.'
    }
};

window.STROBOT_COURSE_LABS = {
    arduino: ['circuit', 'avr', 'wokwi', 'phet', 'local'],
    microbit: ['makecode', 'micropython', 'arcade', 'scratch', 'local'],
    'vex-iq': ['gears', 'openroberta', 'vexiq', 'scratch', 'arcade', 'local'],
    'lego-spike': ['gears', 'openroberta', 'spike', 'scratch', 'local'],
    'vex-vr': ['gears', 'vexvr', 'openroberta', 'arcade', 'scratch', 'local']
};
