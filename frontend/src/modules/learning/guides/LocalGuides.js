// Each recipe names controls that exist in the fixed lesson bench.
const RECIPES = {
    arduino: {
        led: {
            steps: ['Giữ Đường dẫn = Mạch kín, Cực LED = Thuận chiều. Dự đoán dòng trước khi nhập Điện trở nối tiếp = 330 Ω rồi bấm Thử mạch.', 'Đổi riêng điện trở thành 1000 Ω, bấm Thử mạch và ghi mA. Thử thêm 220 Ω để kiểm tra mục tiêu I ≤ 10 mA.', 'Giữ 330 Ω rồi thử Mạch hở, sau đó LED ngược. Ghi đường kín và chiều LED ảnh hưởng kết quả thế nào.'],
            expected: ['330 Ω → 9,09 mA; 1000 Ω → 3 mA; 220 Ω → 13,64 mA theo nguồn 5 V, LED rơi áp 2 V cố định.', 'Mạch hở/LED ngược cho 0 mA trong mô hình; không mô phỏng dòng rò, đánh thủng hay hỏng LED.'],
            evidence: ['Bảng R/đường dẫn/cực tính/dự đoán/dòng mA; chọn giá trị đạt ≤ 10 mA.']
        },
        timing: {
            steps: ['Nhập Thời gian bật = 200, Thời gian tắt = 800, Mỗi bước thời gian = 100 ms; dự đoán T, f, D rồi bấm Áp dụng nhịp từ t = 0.', 'Bấm Bước thời gian: ghi trạng thái tại 100,200,900,1000 ms. Ở pha đúng 200 ms LED đã tắt; 1000 ms bắt đầu chu kỳ mới.', 'Thử 250/750 ms rồi 125/375 ms, bấm Áp dụng mỗi lần đổi. Đối chiếu tỷ lệ bật giữ 25% nhưng tần số đổi từ 1 sang 2 Hz.'],
            expected: ['200/800 cho T=1000 ms, f=1 Hz, D=20%; 250/750 cho 25%; 125/375 cho 2 Hz và 25%.', 'Bước thời gian là số do bạn tăng, không phải phép đo đồng hồ của chương trình delay.'],
            evidence: ['Bảng on/off/T/f/D và trạng thái ở biên pha; ghi rõ thời gian mô hình.']
        },
        distance: {
            steps: ['Dự đoán rồi nhập Độ rộng Echo = 1000 µs, bấm Đổi Echo thành khoảng cách và ghi cm.', 'Chỉ đổi Echo thành 2000 µs rồi chạy lại. Chỉ ra vì sao công thức chia 2 cho đường đi và về.', 'Thử 0 rồi 30001 µs: giữ kết quả No echo/ngoài cửa sổ, không thay bằng 0 cm.'],
            expected: ['1000 µs → 17 cm; 2000 µs → 34 cm với vận tốc giả định 0,034 cm/µs.', '0 hoặc >30000 µs không có khoảng cách hợp lệ.'],
            evidence: ['Bảng Echo µs/dự đoán/khoảng cách hoặc lỗi; chỉ rõ hệ số 1/2.']
        },
        alarm: {
            steps: ['Giữ Ngưỡng = 20 cm, Điều kiện gần = <, Dữ liệu = Echo hợp lệ. Nhập lần lượt 19,20,21 cm và bấm Kiểm tra một mẫu mỗi lần.', 'Giữ 20 cm rồi đổi dấu sang <= để kiểm tra riêng ca biên; ghi nhánh thay đổi.', 'Đổi Dữ liệu thành Timeout / mất Echo và chạy: ghi SENSOR_ERROR và LED sáng theo chính sách lỗi.'],
            expected: ['Dấu <: 19 → NEAR/sáng; 20,21 → FAR/tắt. Dấu <= nhận cả 20.', 'Lỗi làm LED sáng nhưng không chứng minh vật đang gần.'],
            evidence: ['Bảng khoảng cách/dấu/tính hợp lệ/nhánh/LED gồm đúng ngưỡng và mất Echo.']
        },
        calibration: {
            steps: ['Giữ ba số Đo tại chuẩn 10/20/30 cm = 11/21/31. Dự đoán offset rồi bấm Tính và kiểm chứng bù offset.', 'Giữ Mẫu mới tại chuẩn 25 cm = 26,2: ghi giá trị sau bù và sai số trước/sau. Không dùng điểm này để học offset.', 'Chỉ đổi mẫu mới thành 24,5 rồi tính lại: kiểm tra có phải mọi mẫu đều tốt hơn sau bù không.'],
            expected: ['Offset=1 cm; 26,2 → 25,2 cm; sai số 1,2 → 0,2 cm.', 'Mẫu mới 24,5 bù thành 23,5: sai số tăng từ 0,5 lên 1,5 cm; bù offset không chữa mọi sai số.'],
            evidence: ['Ba điểm học offset và điểm kiểm chứng riêng; bảng sai số trước/sau, gồm ca bù làm xấu hơn.']
        },
        project: {
            steps: ['Nhập Chuỗi mẫu = 30,19,20,22, X,25,26; bấm Đặt lại OFF và đầu chuỗi. Dự đoán cả trạng thái nhớ và LED cho từng mẫu.', 'Bấm Bước chuỗi mẫu bảy lần; ghi nhớ trước/sau, ON/OFF/SENSOR_ERROR và đầu ra LED. X là timeout.', 'Đặt lại rồi thử 22 trước 19: 22 từ OFF giữ OFF. So với 22 sau 19 giữ ON để chứng minh vai trò lịch sử.'],
            expected: ['Trạng thái nhớ của chuỗi: OFF, ON, ON, ON, ON, ON, OFF. X làm LED báo lỗi nhưng giữ biến nhớ ON.', 'Đúng 20/25 và trong khoảng giữa hai ngưỡng giữ trạng thái trước.'],
            evidence: ['Bảng bảy mẫu gồm trạng thái trước/sau và LED; hai lượt 22 cm có lịch sử khác nhau.']
        }
    },
    microbit: {
        matrix: {
            steps: ['Bấm Xóa / đặt lại. Dùng Tọa độ x/y và Bật điểm để tạo (2,2),(1,2),(3,2),(2,1),(2,3), hoặc bấm trực tiếp năm ô.', 'Ghi số LED và tọa độ; bật lại (2,2), kiểm tra số điểm vẫn là 5. Bấm Tắt điểm để bỏ riêng một điểm.', 'Xóa rồi tạo chữ L bằng cột x=0 và hàng y=4; đếm 9 điểm vì góc (0,4) chỉ tính một lần.'],
            expected: ['Chữ thập có 5 LED, chữ L có 9; bật lại điểm đang sáng không thêm điểm.', 'Tọa độ nguyên 0..4; x sang phải, y xuống dưới.'],
            evidence: ['Ảnh/tọa độ của hai hình và kết quả bật lại một điểm.']
        },
        buttons: {
            steps: ['Bấm Khởi động lại rồi thử Bấm A: hiện trái tim hai lần, tiếp đến Bấm B: xóa. Ghi hình sau mỗi sự kiện.', 'Khởi động lại rồi thử B, A; đối chiếu với A, B.', 'Giải thích một lần nhấn nút trang tạo một sự kiện; mô hình này không có đo giữ nút hay thời điểm thăm dò MicroPython.'],
            expected: ['A, A, B cho tim, tim, trống; B, A cho trống, tim.', 'Sự kiện sau có thể ghi đè trạng thái hiển thị của sự kiện trước.'],
            evidence: ['Bảng hai thứ tự sự kiện và hình sau từng bước.']
        },
        light: {
            steps: ['Giữ Ngưỡng = 80. Dự đoán rồi bấm Thử ngưỡng − 1, Thử đúng ngưỡng, Thử ngưỡng + 1.', 'Ghi các mức 79/80/81 cùng hình. Đổi ngưỡng thành 100 rồi thử lại ba nút.', 'Tự nhập Mức sáng tương đối khác, bấm Đọc một mẫu; nêu đây là số nhập giả định, không đọc ánh sáng phòng.'],
            expected: ['79<80 hiện tim; 80 và 81 xóa. Ở ngưỡng 100, chỉ 99 trong ba ca hiện tim.', 'Mức 0..255 là thang tương đối, không có đơn vị lux.'],
            evidence: ['Hai bảng ba ca biên với ngưỡng 80 và 100.']
        },
        counter: {
            steps: ['Bấm Khởi động lại, rồi Bấm A (+1), A, B (đặt 0), B, A. Dự đoán trước và ghi số sau mỗi lượt.', 'Bấm A+B cùng lượt (B ưu tiên) để kiểm tra ưu tiên reset; bấm B lại kiểm tra reset lặp.', 'Khởi động lại xác nhận 0. Đối chiếu bảng trạng thái với biến count trong mẫu MicroPython, không gọi đây là lần chạy Python.'],
            expected: ['Chuỗi khởi động, A, A, B, B, A cho 0,1,2,0,0,1; A+B cho 0.', 'Số hiện là biến mô hình, không mô phỏng chữ cuộn LED hay thời gian thăm dò nút.'],
            evidence: ['Bảng sự kiện/count gồm reset lặp và A+B.']
        },
        radio: {
            steps: ['Giữ Nhóm bên gửi = 7, Tên trường = temp, Giá trị = 23; bấm Gửi một bản tin mô hình.', 'Thử các giá trị −20,60,999; tiếp theo giữ 23 và đổi tên thành other, đổi nhóm thành 8 ở lượt riêng. Ghi chấp nhận hay loại.', 'Bấm Không có bản tin mới và đọc giá trị lưu; đổi về nhóm 7/temp rồi gửi 0 để phân biệt nhận 0 với không nhận gì.'],
            expected: ['Nhóm 7/temp/−20..60 được nhận; nhóm/tên sai hoặc 999 bị loại và giữ giá trị cũ.', 'Không có bản tin mới không đặt dữ liệu về 0; mô hình không phát sóng và không kiểm tra chuỗi sai cú pháp.'],
            evidence: ['Bảng nhóm/tên/giá trị/chấp nhận/giá trị lưu, gồm nhận 0 và không có tin.']
        },
        project: {
            steps: ['Ở lựa chọn quy tắc, dùng bản đúng. Bấm Chạy 3 ca kiểm thử mô hình và ghi số ca đạt.', 'Chọn bản lỗi đặt về 1 khi A rồi thử chuỗi A, A bằng nút Bấm A; ghi kỳ vọng 2, kết quả 1.', 'Đổi về quy tắc đúng, Khởi động lại và chạy lại ba ca. Thêm ca A+B, B, B để kiểm tra ưu tiên và reset lặp.'],
            expected: ['Bản đúng tích lũy, bản lỗi mỗi A gán 1 và trượt ca A, A.', 'Nút kiểm thử chạy quy tắc có sẵn, không đọc hoặc thực thi mã trong editor.'],
            evidence: ['Tên quy tắc đã chọn, ba ca trước/sau sửa và chuỗi ngắn nhất tái hiện lỗi.']
        }
    },
    'vex-iq': {
        drive: {
            steps: ['Giữ Hướng khởi đầu = đông, Tuyến lệnh F, L, R = F, F, F. Bấm Đặt lại điểm đầu, dự đoán ô sau từng F.', 'Bấm Bước một lệnh ba lần; ghi (1,0),(2,0),(3,0), hướng đông và ba lệnh tiến.', 'Đổi hướng khởi đầu thành nam, Đặt lại điểm đầu rồi chạy cùng tuyến. Nối chương trình → bộ điều khiển → motor → bánh, nhưng không coi ô là mm thực đo.'],
            expected: ['Từ (0,0, đông), F, F, F kết thúc (3,0, đông); từ hướng nam kết thúc (0,3, nam).'],
            evidence: ['Hai bảng vị trí/hướng theo cùng ba lệnh; một sơ đồ chuỗi điều khiển.']
        },
        turn: {
            steps: ['Nhập F, R, F, hướng đông; Đặt lại điểm đầu. Bước từng lệnh và ghi cả ô lẫn hướng.', 'So với F, L, F: từ biên y=0, bước tiến sau L ra khỏi lưới và phải dừng. Đặt lại trước khi đổi tuyến.', 'Thử R, R, R, R từ điểm đầu: kiểm tra hướng trở về đông mà vị trí không đổi.'],
            expected: ['F, R, F cho (1,1, nam); R/L chỉ đổi hướng, không chuyển ô.', 'Ra ngoài biên làm dừng lượt; bốn rẽ phải giữ vị trí và khôi phục hướng.'],
            evidence: ['Bảng sau từng lệnh cho tuyến đúng, tuyến chạm biên và bốn lần rẽ.']
        },
        detect: {
            steps: ['Giữ Ngưỡng T=20 cm, Điều kiện dừng=<, Dữ liệu=Hợp lệ. Thử 19/20/21 cm bằng Kiểm tra quyết định.', 'Ở 20 cm đổi dấu thành <= để kiểm tra riêng ca biên. Ghi cm và mm của cả khoảng cách lẫn ngưỡng.', 'Đổi dữ liệu thành Không hợp lệ, chạy lại và ghi DỪNG/BÁO LỖI.'],
            expected: ['Dấu <:19 dừng,20/21 tiến chậm; dấu <= dừng cả 20. 20 cm=200 mm.', 'Lệnh dừng của quy tắc không là phép đo quãng hãm; dữ liệu lỗi không được thay bằng khoảng cách giả.'],
            evidence: ['Bảng ba ca biên, đổi dấu và dữ liệu lỗi với đơn vị thống nhất.']
        },
        mission: {
            steps: ['Chốt điều kiện đầu (0,0, đông), đích (3,2, nam). Nhập F, F, F, R, F, F và bấm Đặt lại điểm đầu.', 'Dự đoán từng bước rồi Bước một lệnh hoặc Chạy hết từ đầu; ghi 5 tiến/1 rẽ và trạng thái cuối.', 'Đổi tuyến thành F, R, F, L, F, F, R, F, đặt lại rồi chạy. Đánh giá cùng đích và hướng, không chỉ số lệnh.'],
            expected: ['Hai tuyến đều tới (3,2, nam); tuyến đầu 5 tiến/1 rẽ, tuyến sau 5 tiến/3 rẽ.', 'Lưới không tính va chạm cơ khí, độ trượt hay thời gian robot.'],
            evidence: ['Điều kiện đầu/đích đã chốt, hai trace và tiêu chí thành công.']
        },
        odometry: {
            steps: ['Giữ Quãng đường yêu cầu=500 mm, Đường kính bánh=56 mm, Vòng motor/một vòng bánh=1. Dự đoán rồi Tính vòng bánh và kiểm tra hiệu chuẩn.', 'Chỉ đổi quãng đường thành 1000 rồi tính; sau đó về 500 và đổi đường kính thành 112. Đối chiếu quan hệ gấp đôi/chia đôi số vòng.', 'Với ba lượt đo giả định 478,480,482 mm, ghi trung bình 480 và hệ số 500/480; không gọi đó là đo tự động.'],
            expected: ['500 mm/bánh 56 cho khoảng 2,842 vòng/1023,1°; gấp đôi quãng đường nhân đôi vòng, gấp đôi đường kính chia đôi vòng.', 'Trung bình 480 mm; hệ số thử khoảng 1,0417, cần dữ liệu mới để xác minh hiệu chỉnh.'],
            evidence: ['Bảng s, D, tỷ số, n, góc và dữ liệu ba lượt nhập có ghi nguồn giả định.']
        },
        control: {
            steps: ['Giữ Góc mục tiêu=0°, Góc đo=20°, Tốc độ cơ sở=30%, Kp=0,5. Dự đoán hướng rồi Tính một lần phản hồi.', 'Đổi riêng Góc đo=−20° rồi tính; so dấu e và lệnh trái/phải. Quy ước góc dương ngược chiều kim đồng hồ.', 'Thử mục tiêu 179°, đo −179° để xem bọc góc −2°. Tăng Kp đủ gây bão hòa và ghi lệnh bị giới hạn.'],
            expected: ['Đo+20° cho e=−20°, trái 40%, phải 20% → rẽ phải lý tưởng; đo −20° đảo chiều.', 'Bọc góc chọn sai lệch ngắn nhất; clamp −100..100% không chứng minh điều khiển ổn định.'],
            evidence: ['Bảng target/measured/e/Kp/lệnh bánh gồm đảo dấu, qua ±180° và bão hòa.']
        }
    },
    'lego-spike': {
        mechanism: {
            steps: ['Giữ Răng bánh vào=12, Răng bánh ra=36. Nhập Góc motor lần lượt 0°,90°,0°; Tính và đối chiếu ở mỗi mốc.', 'Ghi góc đầu ra 0°,−30°,0° và vị trí nghỉ. Chỉ ra đầu vào, cặp bánh ngoài và tay gạt.', 'Đổi riêng góc motor thành 60° rồi thử; dùng Đảo hai bánh răng để xem tác dụng tỷ số, nhưng không coi đây là motor đang chạy.'],
            expected: ['12:36 cho góc ra bằng −1/3 góc motor:90°→−30°,60°→−20°; dấu âm biểu thị ngược chiều.', 'Mô hình tính góc, không mô phỏng giới hạn cơ khí/kẹt và không chạy Python.'],
            evidence: ['Bảng motor/góc ra, ảnh vị trí nghỉ và sơ đồ truyền động.']
        },
        colors: {
            steps: ['Chọn Nhãn cảm biến giả định=Đỏ rồi Đọc một nhãn; làm tiếp Xanh và Chưa biết.', 'Ghi riêng nhãn bạn chọn và nhóm kết quả A/B/CHECK. Đọc một nhãn lặp năm lần để kiểm tra quy tắc xác định.', 'Đặt lại bảng và giải thích vì sao chọn nhãn không là phép đo ánh sáng, khoảng cách hay màu của vật thật.'],
            expected: ['Đỏ→A, Xanh→B, Chưa biết→CHECK; CHECK không bị ép về một trong hai nhóm.', 'Đầu vào là nhãn do bạn chọn, không có cảm biến quang học.'],
            evidence: ['Bảng ba nhãn/nhóm và một câu phân biệt nhãn giả định với màu vật thật.']
        },
        sort: {
            steps: ['Giữ Số mẫu trống liên tiếp để mở chốt=1, Chu kỳ mới sẽ=Gạt và về mốc thành công. Chọn Có vật đỏ và Đọc một mẫu nhiều lần.', 'Chọn Có vật, màu chưa biết khi vẫn giữ vật; xác nhận không mở thêm lượt. Chọn Xác nhận không có vật rồi đưa Có vật xanh và đọc.', 'Đặt lại; chọn Chu kỳ mới sẽ=Bị kẹt/timeout, đọc đỏ. Ghi lỗi, bộ đếm nhận và hoàn tất riêng; thử ba mẫu trống để hiểu lọc mở chốt.'],
            expected: ['Giữ cùng vật chỉ nhận một chu kỳ; mất nhãn màu chưa đủ xác nhận vùng trống.', 'Chu kỳ lỗi không tăng số hoàn tất; mô hình không ra lệnh motor thực.'],
            evidence: ['Trace đỏ, đỏ, chưa biết, trống, xanh; bộ đếm nhận/hoàn tất và một ca timeout.']
        },
        project: {
            steps: ['Chốt tiêu chí đúng ngăn và mẫu số trước khi thử. Ở Kết quả giả định của một vật, lần lượt thêm đúng, sai, chưa xác định, kẹt qua Thêm kết quả một vật.', 'Ghi tổng lượt và tỷ lệ đúng; không loại lượt chưa hoàn tất hoặc kẹt khỏi mẫu số.', 'Đặt lại bộ thử rồi bấm Thử bộ 12 vật trong đề. Ghi kết quả toàn bộ 12 lượt; đối chiếu với mẫu riêng đã chọn, phân biệt bộ dữ liệu mô hình với 10 lượt thử ở bài mở rộng GearsBot.'],
            expected: ['Bốn lượt đúng/sai/chưa rõ/kẹt có 1 đúng/4=25%.', 'Bộ mẫu 12 vật là dữ liệu giả định có sẵn; không là phép đo một trạm SPIKE hay lần chạy mã của bạn.'],
            evidence: ['Danh sách tất cả lượt, tiêu chí đúng đã chốt và tỷ lệ có mẫu số đầy đủ.']
        },
        ratio: {
            steps: ['Nhập Răng bánh vào=12, Răng bánh ra=36, Tốc độ vào=90 rpm, Mô-men vào=0,1 N·m, Hiệu suất=0,8; dự đoán rồi Tính và đối chiếu.', 'Bấm Đảo hai bánh răng và tính lại; so độ lớn tốc độ và mô-men ước lượng.', 'Chỉ đổi hiệu suất thành 1 rồi đối chiếu mô-men. Ghi rõ không đo được mô-men thực từ hình minh họa.'],
            expected: ['12:36 cho −30 rpm và 0,24 N·m; 36:12 cho −270 rpm và khoảng 0,0267 N·m.', 'Một cặp bánh ngoài đảo chiều; công thức mô-men có hiệu suất do bạn nhập.'],
            evidence: ['Bảng số răng/tốc độ/mô-men/η cho hai chiều tỷ số và điều kiện giả định.']
        },
        state: {
            steps: ['Chọn Số mẫu trống liên tiếp=1 và Đặt lại. Đọc Có vật đỏ: xem WAIT sang CLASSIFY.', 'Bấm Tiến một pha cơ cấu để hoàn tất từng pha hạ/mở giả định tới WAIT_CLEAR. Đọc đỏ lặp rồi nhãn chưa biết: không mở chu kỳ mới.', 'Đọc Xác nhận không có vật để trở lại WAIT; đọc xanh và thử Giả lập timeout cơ cấu. Ghi ERROR và bộ đếm; Đặt lại sau kiểm tra.', 'Đổi yêu cầu trống thành 3, chạy lại và xác nhận một mẫu trống chưa đủ mở chốt.'],
            expected: ['WAIT→CLASSIFY→WAIT_CLEAR→WAIT theo sự kiện; CLASSIFY cần các bước pha hoàn tất.', 'Timeout→ERROR, số hoàn tất không tăng; nhãn chưa biết khi có vật không giải chốt.'],
            evidence: ['Bảng trạng thái trước/sự kiện/sau và bộ đếm, gồm lỗi và 3 mẫu trống.']
        }
    },
    'vex-vr': {
        sequence: {
            steps: ['Nhập Tuyến lệnh=F, F, R, F, Hướng khởi đầu=đông. Đặt lại điểm đầu; dự đoán (x, y, hướng) từng bước.', 'Bấm Bước một lệnh bốn lần; ghi trạng thái sau mỗi lệnh, không coi R là một bước tiến.', 'Đổi thành F, R, F, L, F, đặt lại rồi chạy; chỉ ra lệnh nào làm hai tuyến khác nhau.'],
            expected: ['F, F, R, F kết thúc (2,1, nam); F, R, F, L, F kết thúc (2,1, đông).', 'Cùng vị trí cuối có thể khác hướng cuối.'],
            evidence: ['Hai bảng trace đầy đủ và tiêu chí kiểm tra cả vị trí lẫn hướng.']
        },
        loop: {
            steps: ['Giữ Thân vòng lặp=F, R, Số lần lặp=4, Lệnh sau vòng lặp trống. Đặt lại rồi bước tám lệnh hoặc Chạy hết từ đầu.', 'Ghi trở về (0,0, đông),4 tiến/4 rẽ. Viết rõ thân lặp có cả F và R.', 'Đổi thân thành F và Lệnh sau vòng lặp thành R, đặt lại rồi chạy. Ghi (4,0, nam) và giải thích đặt R ngoài vòng lặp đổi hành vi.'],
            expected: ['(F, R)×4 tạo hình vuông một ô và trở về đầu; F×4 rồi R đi thẳng bốn ô rồi rẽ.', 'Mô hình rời rạc không có sai lệch góc hay trượt bánh.'],
            evidence: ['Thân lặp/số lần/lệnh sau và hai trace để xác định phạm vi vòng lặp.']
        },
        avoid: {
            steps: ['Giữ Cảm biến=Hợp lệ, Đặt lại sân. Trước mỗi Đo lại và bước quyết định, dự đoán ô trước mặt có tường không.', 'Ghi d mô hình 10 cm→R hoặc 100 cm→F cùng vị trí/hướng. Theo dõi cảnh báo lặp vị trí/hướng và giới hạn 20 hành động.', 'Đổi Cảm biến=Lỗi dữ liệu rồi bấm bước: ghi SENSOR_ERROR, vị trí không đổi. Không xóa lượt chưa tới đích khỏi báo cáo.'],
            expected: ['Luật d<20 chọn rẽ phải; sân góc cụt có thể làm lặp và hết 20 hành động.', '10/100 cm là tín hiệu giả định từ ô trước mặt, không là số đo cảm biến vật lý.'],
            evidence: ['Trace quyết định, trạng thái lặp/lý do dừng và ca lỗi không di chuyển.']
        },
        challenge: {
            steps: ['Giữ hướng đông, Chi phí một tiến=1 s, một rẽ=3 s; Nạp tuyến A rồi Chạy hết từ đầu, ghi đích và chi phí.', 'Nạp tuyến B và chạy cùng điều kiện. Chỉ so chi phí nếu tới đúng (3,2); hướng cuối được phép khác.', 'Đổi giá tiến/rẽ thành 2/0,2 s rồi chạy cả A/B; ghi tuyến rẻ hơn đổi thế nào.'],
            expected: ['A có 5 tiến/3 rẽ, B có 7 tiến/2 rẽ: giá 1/3 cho 14 s và 13 s; giá 2/0,2 cho 10,6 s và 14,4 s.', 'Giây là chi phí quy ước, không phải thời gian thực thi trình duyệt hay robot.'],
            evidence: ['Hai bộ chi phí, đích mỗi tuyến và lý do chọn dựa trên cùng tiêu chí.']
        },
        search: {
            steps: ['Giữ sân mẫu 4×3 với tường(1,0),(1,1). Bấm Bước BFS: lấy đầu hàng đợi; ghi ô lấy ra và thứ tự hàng đợi.', 'Tiếp tục hoặc Tìm đến khi kết thúc; ghi đường từ(0,0) tới(3,2), số bước và số ô mở rộng.', 'Bấm thêm tường(1,2), tìm lại để tạo vách kín và ghi NO_PATH. Phục hồi sân mẫu để đối chiếu.'],
            expected: ['Sân mẫu có đường 5 bước qua hàng dưới; BFS dùng FIFO và đánh dấu khi phát hiện.', 'Vách x=1 kín cả 3 hàng cho NO_PATH; BFS tối ưu số cạnh đồng giá, chưa tối ưu số lần rẽ.'],
            evidence: ['Vài bước hàng đợi, đường thành công và bản đồ NO_PATH.']
        },
        experiment: {
            steps: ['Chốt Chi phí tiến=1 s, rẽ=0,5 s, Giới hạn số ô được mở rộng=100. Bấm Chạy BFS và DFS trên cùng ba sân.', 'Lưu tất cả 6 dòng sân/thuật toán, gồm NO_PATH ở sân 3; ghi tỷ lệ hoàn thành và chi phí trung bình của lượt thành công.', 'Giảm ngân sách xuống 2 và chạy lại: ghi EXPANSION_LIMIT. Giữ nguyên sân, thứ tự láng giềng và giá hành động khi so sánh hai thuật toán.'],
            expected: ['Sân 3 có vách kín nên cả hai không hoàn thành; mẫu số luôn 3 sân mỗi thuật toán.', 'Hết ngân sách khác không có đường; chi phí giây được khai báo, không đo đồng hồ.'],
            evidence: ['Bảng 3 sân×2 thuật toán gồm lý do dừng, số ô mở rộng, số bước/rẽ/chi phí và tiêu chí đã chốt.']
        }
    }
};

export function getLocalGuide(courseId, lesson) {
    const recipe = RECIPES[courseId]?.[lesson.id];
    if (!recipe) throw new RangeError(`Không có mô hình ${courseId}/${lesson.id}.`);
    return {
        title: `Bàn thí nghiệm · ${lesson.title}`,
        goal: lesson.goal, activityType: 'primary',
        capability: 'Bàn thí nghiệm là mô hình quy tắc có sẵn của đúng bài. Các nút và đầu vào dưới đây tính kết quả mô hình; chúng không biên dịch hay thực thi mã bạn viết.',
        setupSteps: ['Chọn Bàn thí nghiệm trong bài ở danh sách nền tảng. Các điều khiển hiện ngay trong trang, không cần editor bên ngoài.', 'Đọc dự đoán trước thao tác. Dùng nút Đặt lại/Khởi động lại của mô hình trước khi so hai lượt có lịch sử hoặc điểm đầu.'],
        ...recipe,
        troubleshooting: ['Đã sửa tuyến hoặc hướng giữa lượt: bấm Đặt lại trước khi chạy tiếp để cùng điều kiện đầu.', 'Giá trị bị từ chối: đọc đơn vị và miền cho phép cạnh ô nhập; giữ số hợp lệ, không bỏ qua thông báo.', 'Thay mã trong editor không làm mô hình này đổi quy tắc. Chuyển sang nền tảng chạy được ngôn ngữ tương ứng để kiểm thử mã.'],
        codeExamples: [],
        comparison: {mission: `Dùng “${lesson.title}” để so dự đoán với kết quả; giữ cùng đầu vào khi chuyển nền tảng.`, measurements: recipe.evidence, limit: 'Chỉ so quy tắc, đơn vị và trạng thái tương ứng. Kết quả mô hình không xác nhận độ chính xác cảm biến, cơ khí, thời gian thực hay chương trình của bạn.'}
    };
}
