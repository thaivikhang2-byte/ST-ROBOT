window.onscroll = function() {
    handleScrollEffects();
};

function handleScrollEffects() {
    let scrollTop = document.documentElement.scrollTop;
    let scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    let progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    let progressBar = document.getElementById("scrollProgress");
    if (progressBar) {
        progressBar.style.width = progress + "%";
    }

    let backTopBtn = document.getElementById("backToTop");
    if (backTopBtn) {
        backTopBtn.style.display = scrollTop > 400 ? "block" : "none";
    }
}

function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("site-theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
}

document.addEventListener("DOMContentLoaded", function() {
    if (localStorage.getItem("site-theme") === "dark") {
        document.body.classList.add("dark-mode");
    }
});

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function toggleChatBot() {
    document.getElementById("supportChatWindow").classList.toggle("active");
}

function appendChatMsg(text, sender) {
    let msgContainer = document.getElementById("chatMessageContainer");
    let msgBubble = document.createElement("div");
    msgBubble.className = sender === "user" ? "bot-msg bot-msg-user" : "bot-msg bot-msg-ai";
    msgBubble.innerText = text;
    msgContainer.appendChild(msgBubble);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

function triggerQuickQuery(text) {
    document.getElementById("chatInputField").value = text;
    submitChatQuery();
}

function submitChatQuery() {
    let input = document.getElementById("chatInputField");
    let query = input.value.trim();
    if (query === "") return;
    
    appendChatMsg(query, "user");
    input.value = "";
    
    setTimeout(() => {
        appendChatMsg(generateBotResponse(query), "assistant");
    }, 300);
}

function generateBotResponse(inputStr) {
    let text = inputStr.toLowerCase();
    if (text.includes("arduino")) {
        return "Mạch điều khiển Arduino rất phù hợp cho dự án nhập môn cơ điện tử, xử lý dữ liệu từ cảm biến siêu âm và motor kéo.";
    }
    if (text.includes("microbit") || text.includes("micro:bit")) {
        return "Micro:bit cực kỳ tối ưu cho các bạn làm quen với khối lệnh kéo thả kéo block căn bản trực quan.";
    }
    if (text.includes("vex")) {
        return "Hệ sinh thái VEX IQ chuyên dụng cho các hoạt động thực hành nâng cao và các giải đấu robotics chuyên nghiệp.";
    }
    if (text.includes("lego") || text.includes("spike")) {
        return "Bộ kit LEGO SPIKE Prime hỗ trợ phát triển kỹ năng lắp ráp thông minh và tư duy giải quyết vấn đề nhanh nhẹn.";
    }
    if (text.includes("đăng ký") || text.includes("học")) {
        return "Bạn truy cập trực tiếp mục Đăng ký trên thanh menu để chọn lớp học và ghi danh nhanh chóng.";
    }
    return "Cảm ơn bạn đã quan tâm đến hệ thống khóa học STEM Robotics. Hãy điều hướng qua các tab menu chính để cập nhật đầy đủ thông tin hoặc gửi đơn đăng ký tư vấn cụ thể nhé.";
}

document.addEventListener("DOMContentLoaded", function() {
    let inputField = document.getElementById("chatInputField");
    if (inputField) {
        inputField.addEventListener("keydown", function(e) {
            if (e.key === "Enter") submitChatQuery();
        });
    }
});
