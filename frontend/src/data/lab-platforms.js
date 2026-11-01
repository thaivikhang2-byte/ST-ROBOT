// Existing lab URLs/defaults are preserved from commit 4b26e4a.
// New entries use official iframe endpoints; no external-editor fallback is provided.
window.STROBOT_LAB_PLATFORMS = {
    "circuit": {
        "name": "CircuitJS · Mạch điện",
        "mode": "embed",
        "languages": "Mô phỏng mạch analog",
        "url": "https://www.falstad.com/circuit/circuitjs.html",
        "sourceUrl": "https://www.falstad.com/circuit/",
        "embedSupport": "existing"
    },
    "avr": {
        "name": "AVR8js · Arduino LED",
        "mode": "embed",
        "languages": "Arduino C/C++ · AVR",
        "url": "https://www.falstad.com/circuit/avr8js/",
        "sourceUrl": "https://github.com/wokwi/avr8js",
        "embedSupport": "existing"
    },
    "makecode": {
        "name": "MakeCode · micro:bit",
        "mode": "embed",
        "languages": "Blocks · JavaScript · MakeCode Python",
        "url": "https://makecode.microbit.org/#editor",
        "sourceUrl": "https://makecode.microbit.org/docs",
        "embedSupport": "existing"
    },
    "gears": {
        "name": "GearsBot · Robot 3D",
        "mode": "embed",
        "languages": "Blockly · Python · robot ảo",
        "url": "https://gears.aposteriori.com.sg/",
        "sourceUrl": "https://github.com/QuirkyCort/gears",
        "embedSupport": "existing"
    },
    "wokwi": {
        "name": "Wokwi · Arduino Uno",
        "mode": "embed",
        "languages": "Arduino C/C++ · mô phỏng số",
        "url": "https://wokwi.com/share/embed/322062421191557714",
        "embedUrl": "https://wokwi.com/share/embed/322062421191557714",
        "sourceUrl": "https://docs.wokwi.com/",
        "embedSupport": "official"
    },
    "phet": {
        "name": "PhET · Mạch điện DC",
        "mode": "embed",
        "languages": "Thí nghiệm điện trực quan",
        "url": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html",
        "embedUrl": "https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html",
        "sourceUrl": "https://phet.colorado.edu/en/simulations/circuit-construction-kit-dc",
        "embedSupport": "official"
    },
    "scratch": {
        "name": "Scratch · Mê cung",
        "mode": "embed",
        "languages": "Khối lệnh · chạy dự án mẫu",
        "url": "https://scratch.mit.edu/projects/10128431/embed",
        "embedUrl": "https://scratch.mit.edu/projects/10128431/embed",
        "sourceUrl": "https://scratch.mit.edu/ideas",
        "embedSupport": "official"
    },
    "arcade": {
        "name": "MakeCode Arcade · Trò chơi",
        "mode": "embed",
        "languages": "Blocks · TypeScript · game simulator",
        "url": "https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC",
        "embedUrl": "https://arcade.makecode.com/---run?id=_1yfTMtFAe5yC",
        "sourceUrl": "https://arcade.makecode.com/share",
        "embedSupport": "official"
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
        "scratch",
        "arcade",
        "local"
    ],
    "vex-iq": [
        "gears",
        "scratch",
        "arcade",
        "local"
    ],
    "lego-spike": [
        "gears",
        "scratch",
        "arcade",
        "local"
    ],
    "vex-vr": [
        "gears",
        "scratch",
        "arcade",
        "local"
    ]
};
