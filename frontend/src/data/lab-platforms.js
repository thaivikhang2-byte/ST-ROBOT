// Only verified in-page embeds and the local bench may appear in the lab selector.
// Unverified/blocked providers stay hidden; no external-tab fallback exists.
window.STROBOT_LAB_PLATFORMS = {
    "circuit": {
        "name": "CircuitJS · Mạch điện",
        "mode": "disabled",
        "languages": "Mô phỏng mạch analog",
        "url": "https://www.falstad.com/circuit/circuitjs.html",
        "sourceUrl": "https://www.falstad.com/circuit/",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "avr": {
        "name": "AVR8js · Arduino LED",
        "mode": "disabled",
        "languages": "Arduino C/C++ · AVR",
        "url": "https://www.falstad.com/circuit/avr8js/",
        "sourceUrl": "https://github.com/wokwi/avr8js",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "wokwi": {
        "name": "Wokwi · Arduino Uno",
        "mode": "disabled",
        "languages": "Arduino C/C++ · mô phỏng số",
        "url": "https://wokwi.com/projects/322062421191557714",
        "embedUrl": "https://wokwi.com/share/embed/322062421191557714",
        "sourceUrl": "https://docs.wokwi.com/",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "phet": {
        "name": "PhET · Mạch điện DC",
        "mode": "disabled",
        "languages": "Thí nghiệm điện trực quan",
        "url": "https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc",
        "embedUrl": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html",
        "sourceUrl": "https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "makecode": {
        "name": "MakeCode · micro:bit",
        "mode": "disabled",
        "languages": "Blocks · JavaScript · MakeCode Python",
        "url": "https://makecode.microbit.org/#editor",
        "sourceUrl": "https://makecode.microbit.org/docs",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "micropython": {
        "name": "Python Editor · micro:bit",
        "mode": "disabled",
        "languages": "MicroPython · simulator micro:bit",
        "url": "https://python.microbit.org/v/3",
        "sourceUrl": "https://python.microbit.org/",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "arcade": {
        "name": "MakeCode Arcade · Trò chơi",
        "mode": "disabled",
        "languages": "Blocks · TypeScript · game simulator",
        "url": "https://arcade.makecode.com/#pub:_1yfTMtFAe5yC",
        "embedUrl": "https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC",
        "sourceUrl": "https://arcade.makecode.com/share",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "scratch": {
        "name": "Scratch · Mê cung",
        "mode": "disabled",
        "languages": "Khối lệnh · chạy dự án mẫu",
        "url": "https://scratch.mit.edu/projects/10128431/editor/",
        "embedUrl": "https://scratch.mit.edu/projects/10128431/embed",
        "sourceUrl": "https://scratch.mit.edu/ideas",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "gears": {
        "name": "GearsBot · Robot 3D",
        "mode": "disabled",
        "languages": "Blockly · Python · robot ảo",
        "url": "https://gears.aposteriori.com.sg/",
        "sourceUrl": "https://github.com/QuirkyCort/gears",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "openroberta": {
        "name": "Open Roberta Lab",
        "mode": "disabled",
        "languages": "NEPO Blocks · robot và simulator",
        "url": "https://lab.open-roberta.org/",
        "sourceUrl": "https://github.com/OpenRoberta/openroberta-lab",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "vexiq": {
        "name": "VEXcode IQ · Chính thức",
        "mode": "disabled",
        "languages": "VEX Blocks · Python/C++ tùy cấu hình",
        "url": "https://codeiq.vex.com/",
        "sourceUrl": "https://api.vex.com/iq2/home/",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "spike": {
        "name": "LEGO Education SPIKE",
        "mode": "disabled",
        "languages": "Word Blocks · Python theo app",
        "url": "https://spike.legoeducation.com/",
        "sourceUrl": "https://education.lego.com/en-us/downloads/spike-app/software/",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "vexvr": {
        "name": "VEXcode VR · Chính thức",
        "mode": "disabled",
        "languages": "VEX Blocks · Python tùy cấp truy cập",
        "url": "https://vr.vex.com/",
        "sourceUrl": "https://vr.vex.com/",
        "embedVerification": {
            "status": "unverified"
        }
    },
    "local": {
        "name": "Bàn thí nghiệm trong bài",
        "mode": "local",
        "languages": "Mô hình tương tác · không cần mạng"
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
