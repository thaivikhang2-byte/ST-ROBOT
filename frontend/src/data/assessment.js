// Separate from the practice bank: do not use these items to generate review sessions.
// A and B cover the same six lessons; content balance is not psychometric calibration.
// Scope and models follow ai-server/curriculum.json (Arduino Uno, six lessons).
export const ASSESSMENT_VERSION = 'arduino-prepost-v1';

export const ASSESSMENT_LESSONS = [
    { id: 'led', title: 'Mạch kín và LED' },
    { id: 'timing', title: 'Tín hiệu số và nhịp chớp' },
    { id: 'distance', title: 'Đo khoảng cách với HC-SR04' },
    { id: 'alarm', title: 'Dự án: cảnh báo vật cản' },
    { id: 'calibration', title: 'Hiệu chuẩn và sai số phép đo' },
    { id: 'project', title: 'Dự án: cảnh báo khoảng cách ổn định' }
];

export const ASSESSMENT_FORMS = {
    A: [
        {
            id: 'study:A:led:1', lessonId: 'led',
            q: 'Trong mô hình gần đúng, nguồn 5 V cấp cho LED có điện áp rơi 2 V và điện trở nối tiếp. Muốn dòng điện là 6 mA, giá trị điện trở tính được là bao nhiêu?',
            opts: ['300 Ω', '500 Ω', '3 000 Ω', 'Khoảng 833 Ω'], ans: 1,
            exp: 'R = (5 − 2)/0,006 = 500 Ω. Đây là kết quả tính theo mô hình Vf cố định; chọn linh kiện thật còn phải kiểm tra datasheet và giới hạn dòng.'
        },
        {
            id: 'study:A:led:2', lessonId: 'led',
            q: 'Một mạch nối tiếp gồm nguồn, điện trở, LED đúng cực và công tắc. Khi công tắc mở, nhận xét nào đúng sau khi trạng thái đã ổn định? Bỏ qua dòng rò.',
            opts: ['Dòng qua LED vẫn giữ nguyên vì nguồn còn điện áp', 'Điện áp của nguồn bắt buộc trở thành 0 V', 'Không có dòng duy trì qua nhánh vì đường dẫn bị ngắt', 'Điện trở tự tạo dòng để LED tiếp tục sáng'], ans: 2,
            exp: 'Dòng điện duy trì cần đường dẫn kín trở về nguồn. Công tắc mở ngắt đường dẫn; nguồn vẫn có thể có điện áp dù dòng qua nhánh bằng 0.'
        },
        {
            id: 'study:A:timing:1', lessonId: 'timing',
            q: 'Một tín hiệu lặp lại gồm HIGH 120 ms rồi LOW 280 ms. Cặp tần số và tỷ lệ thời gian HIGH nào đúng theo mô hình lý tưởng?',
            opts: ['2,5 Hz và 30%', '2,5 Hz và 70%', 'Khoảng 8,33 Hz và 30%', '400 Hz và 30%'], ans: 0,
            exp: 'T = 120 + 280 = 400 ms = 0,4 s; f = 1/0,4 = 2,5 Hz; D = 120/400 × 100% = 30%.'
        },
        {
            id: 'study:A:timing:2', lessonId: 'timing',
            q: 'Trong cùng một vòng loop, chương trình cần nháy LED mỗi giây và thường xuyên kiểm tra nút nhấn. Cách tổ chức nào giúp các lần chờ nháy LED không chặn việc đọc nút?',
            opts: ['Đặt delay(1000) trước mỗi lần đọc nút', 'Đổi tên biến delay thành wait', 'Đọc nút một lần trong setup rồi dùng lại mãi', 'So sánh thời gian bằng millis, đọc nút ở mỗi lượt loop'], ans: 3,
            exp: 'So sánh millis cho phép chỉ đổi trạng thái LED khi đủ khoảng thời gian mà không buộc luồng chính dừng chờ. delay dài làm các lệnh đọc nút phía sau phải chờ.'
        },
        {
            id: 'study:A:distance:1', lessonId: 'distance',
            q: 'HC-SR04 đo được xung Echo dài 3 000 µs. Giả sử tốc độ âm là 0,034 cm/µs, khoảng cách một chiều theo mô hình là bao nhiêu?',
            opts: ['102 cm', '10,2 cm', '5,1 cm', '51 cm'], ans: 3,
            exp: 'Echo tương ứng thời gian khứ hồi. d = 0,034 × 3 000/2 = 51 cm.'
        },
        {
            id: 'study:A:distance:2', lessonId: 'distance',
            q: 'Ba lần pulseIn trả về 0, 1 200 và 1 400 µs; 0 biểu thị timeout. Với v = 0,034 cm/µs, khi chỉ lấy trung bình các khoảng cách hợp lệ, kết quả và số mẫu hợp lệ là gì?',
            opts: ['Khoảng 14,73 cm; 3 mẫu hợp lệ', '22,1 cm; 2 mẫu hợp lệ', '0 cm; 1 mẫu hợp lệ', '44,2 cm; 2 mẫu hợp lệ'], ans: 1,
            exp: 'Hai khoảng cách hợp lệ là 20,4 và 23,8 cm, trung bình 22,1 cm. Timeout phải được ghi riêng, không đưa vào phép trung bình như một số đo 0 cm.'
        },
        {
            id: 'study:A:alarm:1', lessonId: 'alarm',
            q: 'Quy tắc cảnh báo một ngưỡng là “bật nếu d < 20 cm, tắt nếu d ≥ 20 cm”, với số đo hợp lệ. Trong ba đầu vào 19,5; 20; 20,5 cm, có bao nhiêu đầu vào làm cảnh báo bật?',
            opts: ['Cả 3 đầu vào', '2 đầu vào', '1 đầu vào', 'Không có đầu vào nào'], ans: 2,
            exp: 'Chỉ 19,5 < 20. Giá trị đúng 20 cm và 20,5 cm thuộc nhánh tắt; dấu < không bao gồm giá trị bằng ngưỡng.'
        },
        {
            id: 'study:A:alarm:2', lessonId: 'alarm',
            q: 'Một hàm trả về khoảng cách hoặc trạng thái lỗi. Thứ tự xử lý nào tránh so sánh dữ liệu lỗi như một số đo khoảng cách?',
            opts: ['Đọc dữ liệu → kiểm tra hợp lệ → nếu hợp lệ mới so ngưỡng', 'So ngưỡng trước rồi mới kiểm tra lỗi', 'Đổi mọi lỗi thành 0 cm rồi so ngưỡng', 'Bỏ kiểm tra lỗi nếu LED đã sáng'], ans: 0,
            exp: 'Cần tách trạng thái lỗi khỏi dữ liệu hợp lệ trước khi ra quyết định theo khoảng cách. Việc thay lỗi bằng 0 cm làm lẫn lỗi đo với vật ở gần.'
        },
        {
            id: 'study:A:calibration:1', lessonId: 'calibration',
            q: 'Ba cặp (mốc chuẩn, số đo) tính bằng cm là (18,20), (30,32), (42,44). Chấp nhận mô hình lệch cố định trong phạm vi này, dùng offset trung bình để hiệu chỉnh số đo mới 38 cm thì được bao nhiêu?',
            opts: ['36 cm', '40 cm', '19 cm', '38 cm'], ans: 0,
            exp: 'Các sai lệch d_đo − d_chuẩn đều là +2 cm, nên offset = 2 cm. d_sửa = 38 − 2 = 36 cm, nằm trong phạm vi mốc đã khảo sát; vẫn cần kiểm chứng trên dữ liệu mới.'
        },
        {
            id: 'study:A:calibration:2', lessonId: 'calibration',
            q: 'Mốc chuẩn là 30 cm, cảm biến cho số đo 27 cm. Theo e = d_đo − d_chuẩn, cặp sai số có dấu e và sai số tuyệt đối |e| là gì?',
            opts: ['+3 cm và 3 cm', '−3 cm và −3 cm', '−3 cm và 3 cm', '+57 cm và 57 cm'], ans: 2,
            exp: 'e = 27 − 30 = −3 cm, còn |e| = 3 cm. Dấu âm cho biết số đo thấp hơn mốc, không phải một sai số tuyệt đối âm.'
        },
        {
            id: 'study:A:project:1', lessonId: 'project',
            q: 'Cảnh báo khởi tạo OFF; d < 20 thì ON, d > 25 thì OFF, còn lại giữ trạng thái trước. Tất cả số đo đều hợp lệ. Với chuỗi 21, 19, 25, 26 cm, chuỗi trạng thái sau từng mẫu là gì?',
            opts: ['OFF, ON, OFF, OFF', 'OFF, ON, ON, OFF', 'ON, ON, ON, OFF', 'OFF, OFF, ON, OFF'], ans: 1,
            exp: '21 cm giữ OFF; 19 cm bật ON; đúng 25 cm vẫn thuộc vùng giữ nên ON; 26 > 25 làm tắt OFF.'
        },
        {
            id: 'study:A:project:2', lessonId: 'project',
            q: 'Muốn so sánh mức rung bật/tắt giữa cách dùng một ngưỡng và hai ngưỡng, phép thử nào cho phép đối chiếu trực tiếp hành vi quyết định của hai cách?',
            opts: ['Chạy mỗi cách với một chuỗi số đo khác nhau rồi chọn kết quả đẹp hơn', 'Chỉ chụp ảnh LED ở cuối một lần chạy', 'Cho cách hai ngưỡng thời gian thử dài hơn rồi chỉ so tổng lần bật', 'Cho cả hai cùng trạng thái đầu và cùng chuỗi số đo dao động, đếm số lần đổi trạng thái'], ans: 3,
            exp: 'Cùng đầu vào và trạng thái đầu giúp đối chiếu hành vi hai thuật toán. Số lần đổi trạng thái đo sự rung quyết định trong bộ thử đó, không tự chứng minh độ chính xác cảm biến hay an toàn của thiết bị.'
        }
    ],
    B: [
        {
            id: 'study:B:led:1', lessonId: 'led',
            q: 'Nguồn 5 V cấp cho LED có Vf giả định 2 V qua điện trở 200 Ω. Theo mô hình gần đúng I = (Vs − Vf)/R, dòng qua nhánh là bao nhiêu?',
            opts: ['25 mA', '1,5 mA', '15 mA', '600 mA'], ans: 2,
            exp: 'I = (5 − 2)/200 = 0,015 A = 15 mA. Công thức dùng Vf cố định chỉ là ước lượng, không thay việc kiểm tra linh kiện và giới hạn dòng.'
        },
        {
            id: 'study:B:led:2', lessonId: 'led',
            q: 'Trong mạch LED rời đã lắp đúng cực và có điện trở nối tiếp, dây hồi về GND bị rời. Chỉ đặt chân điều khiển thành HIGH có đủ để bảo đảm dòng qua LED không? Xét mạch lý tưởng không có đường hồi khác.',
            opts: ['Có, HIGH tự tạo đường hồi', 'Có, vì điện trở lưu sẵn dòng điện', 'Có, chỉ cần đặt tên chân là LED', 'Không, vẫn thiếu đường dẫn kín trở về nguồn'], ans: 3,
            exp: 'HIGH đặt mức điện áp theo điều khiển, không thay dây hồi còn thiếu. Đường đi của dòng phải kín; cần ngắt nguồn trước khi kiểm tra và sửa dây.'
        },
        {
            id: 'study:B:timing:1', lessonId: 'timing',
            q: 'Một xung lặp có chu kỳ 500 ms và tỷ lệ thời gian HIGH là 60%. Cặp thời gian HIGH và tần số nào đúng?',
            opts: ['200 ms và 2 Hz', '300 ms và 2 Hz', '300 ms và 0,5 Hz', '500 ms và 60 Hz'], ans: 1,
            exp: 't_HIGH = 60% × 500 = 300 ms; f = 1/0,5 s = 2 Hz. Thời gian LOW còn lại là 200 ms.'
        },
        {
            id: 'study:B:timing:2', lessonId: 'timing',
            q: 'Trong loop, lệnh đọc cảm biến nằm ngay sau delay(2000). Trong thời gian chờ này, điều gì xảy ra với lần đọc cảm biến đó trong luồng chính?',
            opts: ['Phải chờ delay kết thúc mới được thực hiện', 'Vẫn được thực hiện liên tục do tên hàm là loop', 'Tự thực hiện 2 000 lần', 'Không thể chạy nữa vì delay đã tắt nguồn bo mạch'], ans: 0,
            exp: 'delay(2000) làm luồng chính chờ khoảng 2 s, nên lệnh đọc phía sau chưa được thực hiện trong khoảng chờ đó. Đây không phải thao tác tắt nguồn bo mạch.'
        },
        {
            id: 'study:B:distance:1', lessonId: 'distance',
            q: 'Vật cách cảm biến 42,5 cm theo mô hình lý tưởng. Với tốc độ âm 0,034 cm/µs, thời gian khứ hồi Echo dự kiến là bao nhiêu?',
            opts: ['2 500 µs', '1 250 µs', '85 µs', '25 000 µs'], ans: 0,
            exp: 't = 2d/v = 2 × 42,5/0,034 = 2 500 µs. Không dùng d/v vì xung Echo biểu diễn hành trình đi và về.'
        },
        {
            id: 'study:B:distance:2', lessonId: 'distance',
            q: 'Một bạn thấy chuỗi Echo 1 000, 0, 1 000 µs và thay giá trị timeout 0 bằng khoảng cách 0 cm trước khi lấy trung bình. Với hai mẫu hợp lệ cùng tương ứng 17 cm, nhận xét nào đúng?',
            opts: ['Cách đó đúng vì mọi lần đọc đều là số đo khoảng cách', 'Khoảng cách trung bình hợp lệ phải là 0 cm', 'Cách đó kéo trung bình xuống sai; cần tách timeout và trung bình hai mẫu hợp lệ thành 17 cm', 'Phải loại cả hai mẫu 1 000 µs vì chúng bằng nhau'], ans: 2,
            exp: 'Timeout không cung cấp khoảng cách 0 cm. Hai mẫu hợp lệ là 17 và 17 cm, trung bình 17 cm; một mẫu lỗi được ghi riêng.'
        },
        {
            id: 'study:B:alarm:1', lessonId: 'alarm',
            q: 'Đặc tả yêu cầu bật khi d < 20 cm, nhưng chương trình viết nhầm d ≤ 20 cm. Đầu vào hợp lệ nào dưới đây phân biệt được hai điều kiện?',
            opts: ['5 cm', '19 cm', '21 cm', '20 cm'], ans: 3,
            exp: 'Tại d = 20, d < 20 là sai còn d ≤ 20 là đúng. Các giá trị còn lại cho cùng kết quả ở cả hai điều kiện.'
        },
        {
            id: 'study:B:alarm:2', lessonId: 'alarm',
            q: 'Trong chính sách của bài cảnh báo một ngưỡng, mất Echo làm LED sáng và in SENSOR_ERROR. Khi thấy đúng hai dấu hiệu này, kết luận nào phù hợp?',
            opts: ['Đã đo chắc chắn được vật ở dưới 20 cm', 'Hệ thống đang báo lỗi đo, chưa có khoảng cách hợp lệ để kết luận gần hay xa', 'Khoảng cách vừa đo chính xác là 0 cm', 'Phía trước chắc chắn không có vật'], ans: 1,
            exp: 'LED sáng có thể là dấu hiệu lỗi theo chính sách của chương trình. SENSOR_ERROR cho biết chưa có số đo hợp lệ; không được suy ra vật gần, vật xa hoặc khoảng cách 0 cm.'
        },
        {
            id: 'study:B:calibration:1', lessonId: 'calibration',
            q: 'Tập hiệu chuẩn cho thấy d_đo − d_chuẩn gần cố định −2 cm. Với mô hình d_sửa = d_đo − offset, số đo mới 36 cm sẽ được hiệu chỉnh thành bao nhiêu?',
            opts: ['34 cm', '38 cm', '18 cm', '36 cm'], ans: 1,
            exp: 'offset = −2 cm nên d_sửa = 36 − (−2) = 38 cm. Dấu âm cho biết số đo thô đang thấp hơn mốc; mô hình vẫn cần được kiểm chứng trong phạm vi sử dụng.'
        },
        {
            id: 'study:B:calibration:2', lessonId: 'calibration',
            q: 'Đã tính offset từ các mốc 10, 20 và 30 cm. Muốn kiểm tra bù lệch có ích trên dữ liệu chưa dùng để tính offset, nên làm gì?',
            opts: ['Đo thêm tại mốc mới, giữ điều kiện so sánh và đối chiếu sai số trước/sau bù', 'Chỉ chép lại kết quả ở ba mốc đã dùng để tính offset', 'Xóa những lần đo có sai số lớn khỏi báo cáo', 'Tăng offset cho đến khi mọi kết quả trên giấy bằng mốc'], ans: 0,
            exp: 'Dữ liệu ở mốc mới cho phép kiểm tra khả năng áp dụng của mô hình ngoài tập dùng để tính offset. Cần báo cáo điều kiện, mẫu lỗi và sai số; không chọn lọc chỉ các kết quả thuận lợi.'
        },
        {
            id: 'study:B:project:1', lessonId: 'project',
            q: 'Quy tắc là d < 20 thì ON, d > 25 thì OFF, ở giữa giữ trạng thái. Mẫu hợp lệ trước là 26 cm làm cảnh báo OFF; mẫu kế là 24 cm. Trạng thái sau mẫu 24 cm là gì?',
            opts: ['ON vì 24 < 25', 'Không thể xác định dù đã biết trạng thái trước', 'OFF vì 24 cm thuộc vùng giữ trạng thái', 'Bắt buộc đổi trạng thái sau mỗi mẫu'], ans: 2,
            exp: '24 cm không thỏa d < 20 và không thỏa d > 25, nên giữ trạng thái OFF đã biết từ mẫu 26 cm. Hysteresis cần nhớ trạng thái trước đó.'
        },
        {
            id: 'study:B:project:2', lessonId: 'project',
            q: 'Mô hình hai ngưỡng đang nhớ OFF. Theo chính sách bài học, timeout giữ nguyên trạng thái nhớ nhưng bật LED báo lỗi; khi số đo hợp lệ trở lại thì cập nhật bằng hai ngưỡng 20/25 cm. Sau timeout rồi đến số đo 22 cm, trạng thái nhớ và LED trở về thế nào?',
            opts: ['Nhớ ON và LED sáng vì timeout đã thay đổi bộ nhớ thành ON', 'Nhớ OFF nhưng LED phải sáng mãi sau mọi timeout', 'Không thể xử lý số đo hợp lệ sau khi từng timeout', 'Nhớ OFF và LED tắt vì 22 cm giữ OFF; lỗi đo đã kết thúc'], ans: 3,
            exp: 'Trong chính sách được nêu, timeout bật LED gây chú ý nhưng không đổi trạng thái nhớ. Khi 22 cm hợp lệ trở lại, vùng giữ trạng thái bảo toàn OFF và LED theo trạng thái OFF. Đây là hành vi mô hình, không phải bảo đảm an toàn thực tế.'
        }
    ]
};
