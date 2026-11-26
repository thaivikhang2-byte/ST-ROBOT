const WORKFLOWS = {
    circuit: {
        mode: 'files', sourceLabel: 'Mạch CircuitJS',
        codeLabel: 'Văn bản mạch CircuitJS', codeVisible: true,
        notesLabel: 'Giá trị linh kiện và kết quả đo',
        notesPlaceholder: 'Ví dụ: nguồn 5 V; R = 330 Ω rồi 1 kΩ; ghi dòng LED ở mỗi lượt.',
        extensions: ['.txt'], defaultExtension: '.circuitjs.txt', projectUrlVisible: false,
        saveSteps: [
            'Trong CircuitJS, mở File → Save As… để tải tệp mạch. Có thể dùng File → Export As Text… rồi sao chép toàn bộ văn bản mạch.',
            'Ở phần Lưu bài thực hành, thêm tệp .txt. Nếu dùng văn bản mạch, mở Bản sao mã nguồn rồi dán toàn bộ nội dung. Ghi giá trị đã thay và kết quả đo.',
            'Bấm Lưu bài thực hành và chờ thông báo đã đồng bộ vào tài khoản.'
        ],
        reopenSteps: [
            'Mở đúng bài và chọn CircuitJS. Tải tệp mạch đã lưu trong tài khoản.',
            'Trong CircuitJS, chọn File → Open File… để mở tệp. Nếu dùng văn bản, chọn File → Import From Text… rồi dán toàn bộ nội dung.',
            'Kiểm tra sơ đồ và giá trị linh kiện trước khi chạy lại.'
        ]
    },
    avr: {
        mode: 'files', sourceLabel: 'Chương trình Arduino',
        codeLabel: 'Sketch Arduino C++', codeVisible: true,
        notesLabel: 'Tham số và kết quả chạy LED',
        notesPlaceholder: 'Ghi các giá trị đã sửa, nhịp LED quan sát được và việc cần làm tiếp.',
        extensions: ['.ino', '.cpp', '.c', '.h', '.txt', '.zip'], defaultExtension: '.ino', projectUrlVisible: false,
        saveSteps: [
            'Dừng chương trình trong AVR8js. Mở Bản sao mã nguồn ở phần Lưu bài thực hành, rồi dán toàn bộ sketch đang chạy vào ô Sketch Arduino C++.',
            'Ghi các tham số đã đổi và nhịp LED đã kiểm tra. Nếu có tệp .ino trên máy, đính kèm tệp đó.',
            'Bấm Lưu bài thực hành và chờ thông báo đã đồng bộ vào tài khoản.'
        ],
        reopenSteps: [
            'Mở đúng bài và chọn AVR8js. Sao chép sketch đã lưu hoặc tải tệp .ino từ tài khoản.',
            'Dừng chương trình trong AVR8js, thay toàn bộ sketch bằng bản đã lưu rồi bấm Run.',
            'Đối chiếu nhịp LED với ghi chú của lần thử trước.'
        ]
    },
    wokwi: {
        mode: 'project', sourceLabel: 'Dự án Wokwi',
        codeLabel: 'sketch.ino — bản sao mã Arduino', codeVisible: true,
        notesLabel: 'Sơ đồ nối dây và kết quả thử',
        notesPlaceholder: 'Ghi tên linh kiện, chân nối, giá trị đầu vào và các dòng Serial cần đối chiếu.',
        extensions: ['.ino', '.cpp', '.c', '.h', '.json', '.txt', '.zip'], defaultExtension: '.ino',
        projectUrlVisible: true, projectUrlLabel: 'Liên kết dự án Wokwi của bạn',
        saveSteps: [
            'Bấm Mở tab riêng để chỉnh dự án Wokwi. Đăng nhập Wokwi và lưu dự án vào tài khoản của bạn.',
            'Sao chép địa chỉ dự án /projects/… và dán vào ô Liên kết dự án Wokwi của bạn. Có thể lưu thêm sketch.ino và diagram.json để giữ cả mã lẫn sơ đồ.',
            'Ghi các ca đã thử, bấm Lưu bài thực hành và chờ thông báo đã đồng bộ vào tài khoản.'
        ],
        reopenSteps: [
            'Mở đúng bài, chọn Wokwi rồi mở liên kết dự án đã lưu. Đăng nhập tài khoản Wokwi sở hữu dự án nếu được yêu cầu.',
            'Nếu khôi phục từ tệp, tạo dự án Arduino Uno và đưa sketch.ino, diagram.json cùng các tệp phụ về đúng dự án.',
            'Kiểm tra chân nối và chạy lại ca thử trong ghi chú.'
        ]
    },
    python: {
        mode: 'files', sourceLabel: 'Dự án micro:bit Python',
        codeLabel: 'main.py — bản sao mã MicroPython', codeVisible: true,
        notesLabel: 'Đầu vào và kết quả trên micro:bit',
        notesPlaceholder: 'Ghi nút đã bấm hoặc giá trị cảm biến, hình LED/đầu ra và bước cần làm tiếp.',
        extensions: ['.py', '.hex', '.json', '.zip'], defaultExtension: '.py', projectUrlVisible: false,
        saveSteps: [
            'Sau khi sửa trong editor nhúng, chờ thông báo lưu của editor. Dự án nhúng được giữ theo tài khoản và bài học.',
            'Mở Bản sao mã nguồn, bấm Lấy mã Python đang mở để giữ thêm bản sao main.py. Nếu làm trong tab riêng, tải tệp .py hoặc .hex từ editor rồi đính kèm tại đây.',
            'Ghi các đầu vào đã thử, bấm Lưu bài thực hành và chờ thông báo đã đồng bộ vào tài khoản.'
        ],
        reopenSteps: [
            'Đăng nhập, mở đúng bài rồi chọn micro:bit Python Editor. Editor nhúng mở dự án đã đồng bộ của bài đó.',
            'Nếu chỉ có bản sao main.py, sao chép mã từ bài đã lưu vào editor. Tệp .py là bản mã chính; dự án có nhiều tệp cần giữ đầy đủ các tệp phụ.',
            'Bấm Run trong editor và thử lại các nút hoặc giá trị cảm biến đã ghi.'
        ]
    },
    gears: {
        mode: 'files', sourceLabel: 'Dự án robot GearsBot',
        codeLabel: 'Mã Python — bản sao chương trình', codeVisible: true,
        notesLabel: 'Robot, sân và kết quả chạy',
        notesPlaceholder: 'Ghi robot đã chọn, sân, vị trí xuất phát, tham số và kết quả từng lượt.',
        extensions: ['.py', '.xml', '.json', '.zip'], defaultExtension: '.py', projectUrlVisible: false,
        saveSteps: [
            'Trong GearsBot, đặt tên dự án rồi chọn File → Export zip package to your computer. Tệp ZIP giữ chương trình, khối lệnh và cấu hình robot.',
            'Nếu đã chỉnh sân, chọn Worlds → Save to file để tải thêm tệp sân .json. Sân không nằm trong gói ZIP của chương trình.',
            'Đính kèm tệp ZIP và tệp sân .json vào bài. Ghi robot, vị trí xuất phát và kết quả; bấm Lưu bài thực hành rồi chờ đồng bộ.'
        ],
        reopenSteps: [
            'Tải các tệp từ bài đã lưu trong tài khoản. Trong GearsBot, chọn File → Import zip package from your computer để mở gói chương trình.',
            'Nếu có tệp sân, chọn Worlds → Load from file rồi mở tệp .json tương ứng. Kiểm tra robot và vị trí xuất phát.',
            'Bấm Reset rồi Run. Nếu chỉ lưu tệp .py hoặc .xml, mở bằng File → Load Python from your computer hoặc Load blocks from your computer, rồi chọn lại robot và sân.',
            'Trên máy dùng chung, luôn mở tệp của mình trước khi chạy. GearsBot có thể giữ dự án trước đó trong trình duyệt; đăng xuất ST-Robot không xóa bản nháp của GearsBot.'
        ]
    },
    phet: {
        mode: 'worksheet', sourceLabel: 'Phiếu thí nghiệm PhET',
        codeLabel: '', codeVisible: false,
        notesLabel: 'Cách mắc mạch, giá trị và kết quả',
        notesPlaceholder: 'Ghi nguồn điện, linh kiện, cách nối dây và bảng số đo để dựng lại thí nghiệm.',
        extensions: [], defaultExtension: '.txt', projectUrlVisible: false,
        saveSteps: [
            'Ghi cách mắc mạch, giá trị nguồn và linh kiện, vị trí đặt dụng cụ đo cùng kết quả từng lượt vào phiếu. Có thể thêm ảnh chụp mạch hoặc tài liệu ở mục Thêm tệp bài làm.',
            'Bấm Lưu bài thực hành và chờ thông báo đã đồng bộ. Phiếu giữ phần ghi chép; bố trí mạch trong PhET cần được dựng lại khi mở phiên mới.'
        ],
        reopenSteps: [
            'Mở đúng bài, chọn PhET và đọc phiếu thí nghiệm đã lưu.',
            'Dựng lại mạch theo cách nối dây và giá trị trong phiếu, đặt dụng cụ đo rồi đối chiếu kết quả.'
        ]
    },
    local: {
        mode: 'worksheet', sourceLabel: 'Phiếu thực hành trong bài',
        codeLabel: '', codeVisible: false,
        notesLabel: 'Đầu vào, kết quả và cách làm',
        notesPlaceholder: 'Ghi giá trị đã nhập, các bước đã làm, kết quả và một điều cần kiểm tra tiếp.',
        extensions: [], defaultExtension: '.txt', projectUrlVisible: false,
        saveSteps: [
            'Ghi đầu vào, các thao tác đã làm và kết quả vào phiếu. Có thể nhận kết quả từ bàn thực hành và thêm ảnh, báo cáo hoặc tệp khác ở mục Thêm tệp bài làm.',
            'Bấm Lưu bài thực hành và chờ thông báo đã đồng bộ. Phiếu giữ kết quả để đối chiếu; mở lại mô hình cần nhập lại các đầu vào đã ghi.'
        ],
        reopenSteps: [
            'Đăng nhập và mở đúng bài. Đọc phiếu thực hành đã lưu.',
            'Đặt lại mô hình, nhập các giá trị trong phiếu rồi làm lại các thao tác để so sánh kết quả.'
        ]
    }
};

for (const workflow of Object.values(WORKFLOWS)) {
    for (const key of ['extensions', 'saveSteps', 'reopenSteps']) Object.freeze(workflow[key]);
    Object.freeze(workflow);
}

/** Native save/reopen instructions for the lab choices offered in this website. */
export function getLabWorkflow(platformKey) {
    if (!Object.hasOwn(WORKFLOWS, platformKey)) throw new RangeError('Nền tảng này không còn trong danh sách thực hành.');
    return WORKFLOWS[platformKey];
}
