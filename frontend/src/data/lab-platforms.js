// Remote iframe use requires a successful check for the current page origin and exact URL.
// Current providers open separately until that check is available; see docs/lab-platforms.md.
window.STROBOT_LAB_PLATFORMS = {
    "circuit": {
        "name": "CircuitJS · Mạch điện",
        "mode": "external",
        "languages": "Mô phỏng mạch analog",
        "url": "https://www.falstad.com/circuit/circuitjs.html",
        "sourceUrl": "https://www.falstad.com/circuit/",
        "note": "Thay linh kiện và quan sát điện áp, dòng điện. CircuitJS không chạy chương trình Arduino và không mô phỏng đầy đủ cảm biến HC-SR04.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "avr": {
        "name": "AVR8js · Arduino LED",
        "mode": "external",
        "languages": "Arduino C/C++ · AVR",
        "url": "https://www.falstad.com/circuit/avr8js/",
        "sourceUrl": "https://github.com/wokwi/avr8js",
        "note": "Demo Arduino kết hợp CircuitJS, phù hợp thử chương trình LED. Biên dịch cần Internet; không phải mọi thư viện hoặc cảm biến Arduino đều được hỗ trợ.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "wokwi": {
        "name": "Wokwi · Arduino Uno",
        "mode": "external",
        "languages": "Arduino C/C++ · mô phỏng số",
        "url": "https://wokwi.com/projects/322062421191557714",
        "embedUrl": "https://wokwi.com/share/embed/322062421191557714",
        "sourceUrl": "https://docs.wokwi.com/",
        "note": "Dự án Arduino Uno mẫu từ hướng dẫn Wokwi. Dùng nút mở riêng để sửa code, thêm linh kiện hoặc tạo bản sao; lưu trữ và một số tính năng có thể cần tài khoản.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "phet": {
        "name": "PhET · Mạch điện DC",
        "mode": "external",
        "languages": "Thí nghiệm điện trực quan",
        "url": "https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc",
        "embedUrl": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html",
        "sourceUrl": "https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc",
        "note": "Bộ thí nghiệm mạch DC của University of Colorado Boulder. Dùng để hiểu mạch kín, dòng điện và đo điện áp; không có trình biên dịch Arduino.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "makecode": {
        "name": "MakeCode · micro:bit",
        "mode": "external",
        "languages": "Blocks · JavaScript · MakeCode Python",
        "url": "https://makecode.microbit.org/#editor",
        "sourceUrl": "https://makecode.microbit.org/docs",
        "note": "Trình soạn thảo kèm simulator micro:bit. MakeCode Python và MicroPython là hai môi trường khác nhau; không dán nguyên API của môi trường này sang môi trường kia.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "micropython": {
        "name": "Python Editor · micro:bit",
        "mode": "external",
        "languages": "MicroPython · simulator micro:bit",
        "url": "https://python.microbit.org/v/3",
        "sourceUrl": "https://python.microbit.org/",
        "note": "Python Editor chính thức của micro:bit có simulator. Phù hợp các ví dụ dùng from microbit import *; một số tính năng và cảm biến chỉ có trên board tương ứng.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "arcade": {
        "name": "MakeCode Arcade · Trò chơi",
        "mode": "external",
        "languages": "Blocks · TypeScript · game simulator",
        "url": "https://arcade.makecode.com/#pub:_1yfTMtFAe5yC",
        "embedUrl": "https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC",
        "sourceUrl": "https://arcade.makecode.com/share",
        "note": "Chạy mẫu Monster Truck Racer trong khung; mở riêng để xem/sửa bản sao bằng Blocks hoặc TypeScript. Đây là trò chơi luyện thuật toán, không phải simulator của board micro:bit hay robot VEX/LEGO.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "scratch": {
        "name": "Scratch · Mê cung",
        "mode": "external",
        "languages": "Khối lệnh · chạy dự án mẫu",
        "url": "https://scratch.mit.edu/projects/10128431/editor/",
        "embedUrl": "https://scratch.mit.edu/projects/10128431/embed",
        "sourceUrl": "https://scratch.mit.edu/ideas",
        "note": "Mẫu Maze Starter được Scratch giới thiệu. Khung nhúng chạy dự án; nút mở riêng đưa đến trình soạn thảo để sửa hoặc remix. Mê cung 2D không mô phỏng động cơ, cảm biến hay kit robot thật.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "gears": {
        "name": "GearsBot · Robot 3D",
        "mode": "external",
        "languages": "Blockly · Python · robot ảo",
        "url": "https://gears.aposteriori.com.sg/",
        "sourceUrl": "https://github.com/QuirkyCort/gears",
        "note": "Robot giáo dục 3D để luyện thuật toán, cảm biến và sa bàn. Không phải trình giả lập chính hãng VEX IQ, VEXcode VR hoặc LEGO SPIKE; cấu hình và API khác với kit thật.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "openroberta": {
        "name": "Open Roberta Lab",
        "mode": "external",
        "languages": "NEPO Blocks · robot và simulator",
        "url": "https://lab.open-roberta.org/",
        "sourceUrl": "https://github.com/OpenRoberta/openroberta-lab",
        "note": "Môi trường NEPO cho nhiều hệ robot. Chọn đúng robot và kiểm tra simulator được cung cấp; không phải cấu hình robot nào cũng hỗ trợ mọi cảm biến hoặc chạy mô phỏng.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "vexiq": {
        "name": "VEXcode IQ · Chính thức",
        "mode": "external",
        "languages": "VEX Blocks · Python/C++ tùy cấu hình",
        "url": "https://codeiq.vex.com/",
        "sourceUrl": "https://api.vex.com/iq2/home/",
        "note": "Trình soạn thảo chính thức dành cho VEX IQ. Chọn đúng thế hệ Brain và cấu hình cổng; việc chạy trên kit cần phần cứng thật, không phải mọi dự án đều có simulator.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "spike": {
        "name": "LEGO Education SPIKE",
        "mode": "external",
        "languages": "Word Blocks · Python theo app",
        "url": "https://spike.legoeducation.com/",
        "sourceUrl": "https://education.lego.com/en-us/downloads/spike-app/software/",
        "note": "Ứng dụng chính thức cho kit LEGO Education SPIKE. Chọn đúng hub/phiên bản API; ứng dụng không phải phòng mô phỏng đầy đủ cơ cấu SPIKE khi không có phần cứng.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "vexvr": {
        "name": "VEXcode VR · Chính thức",
        "mode": "external",
        "languages": "VEX Blocks · Python tùy cấp truy cập",
        "url": "https://vr.vex.com/",
        "sourceUrl": "https://vr.vex.com/",
        "note": "Robot ảo và playground chính thức của VEXcode VR. Một số playground, ngôn ngữ hoặc tính năng có thể phụ thuộc cấp truy cập; dùng nội dung sẵn có và không cần mua thêm để học lý thuyết ST-Robot.",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "local": {
        "name": "Bàn thí nghiệm trong bài",
        "mode": "local",
        "languages": "Mô hình tương tác · không cần mạng",
        "note": "Thử trực tiếp các tham số và quan sát kết quả của mô hình trong bài học. Ghi cả dự đoán, kết quả và giới hạn mô hình vào nhật ký."
    }
};

window.STROBOT_COURSE_LABS = {
    "arduino": [
        "circuit",
        "avr",
        "wokwi",
        "phet",
        "local"
    ],
    "microbit": [
        "makecode",
        "micropython",
        "arcade",
        "scratch",
        "local"
    ],
    "vex-iq": [
        "gears",
        "openroberta",
        "vexiq",
        "scratch",
        "arcade",
        "local"
    ],
    "lego-spike": [
        "gears",
        "openroberta",
        "spike",
        "scratch",
        "local"
    ],
    "vex-vr": [
        "gears",
        "vexvr",
        "openroberta",
        "arcade",
        "scratch",
        "local"
    ]
};
