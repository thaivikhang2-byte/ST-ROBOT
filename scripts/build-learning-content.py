#!/usr/bin/env python3
"""Build browser curriculum and printable course PDFs from one JSON source.

Requires Python 3, reportlab and the DejaVu Sans system font for scientific
symbols missing from the supplied Be Vietnam Pro font. Runtime pages need none
of these tools: generated JavaScript files are committed with the website.

Run from any directory: python3 scripts/build-learning-content.py [--check]
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable, PageBreak, Paragraph, SimpleDocTemplate, XPreformatted,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ai-server/curriculum.json"
OUTPUT = ROOT / "frontend/src/data"
FONTS = ROOT / "frontend/src/assets/fonts/be-vietnam-pro"
SYMBOL_FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
BRAND = colors.HexColor("#0f766e")
TEXT = colors.HexColor("#172338")
MUTED = colors.HexColor("#475569")
_font_faces: dict[str, object] = {}


def validate_courses(courses: list[dict]) -> None:
    """Reject data that could break deep links, grading, or course exports."""
    if not isinstance(courses, list) or not courses:
        raise ValueError("Curriculum must be a nonempty list of courses")
    course_ids = set()
    for course in courses:
        ident = course.get("id", "")
        if not re.fullmatch(r"[a-z0-9-]+", ident) or ident in course_ids:
            raise ValueError(f"Invalid or duplicate course id: {ident!r}")
        course_ids.add(ident)
        if not isinstance(course.get("name"), str) or not course["name"].strip():
            raise ValueError(f"Missing course name: {ident}")
        lessons = course.get("lessons")
        if not isinstance(lessons, list) or len(lessons) != 6:
            raise ValueError(f"{ident}: exactly six lessons are required by the current UI")
        lesson_ids = set()
        for lesson in lessons:
            key = f"{ident}/{lesson.get('id')}"
            lid = lesson.get("id", "")
            if not re.fullmatch(r"[a-z0-9-]+", lid) or lid in lesson_ids:
                raise ValueError(f"Invalid or duplicate lesson id: {key}")
            lesson_ids.add(lid)
            for field in ("title", "goal", "theory", "example", "code", "q", "why", "exercise", "solution", "prereq", "labGuide"):
                if not isinstance(lesson.get(field), str) or not lesson[field].strip():
                    raise ValueError(f"{key}: {field} must be nonempty text")
            if not isinstance(lesson.get("steps"), list) or not lesson["steps"]:
                raise ValueError(f"{key}: missing practice steps")
            for field in ("objectives", "selfCheck", "misconceptions"):
                values = lesson.get(field)
                if not isinstance(values, list) or len(values) < 2 or any(not isinstance(value, str) or not value.strip() for value in values):
                    raise ValueError(f"{key}: {field} requires at least two nonempty teaching points")
            concepts = lesson.get("concepts")
            if not isinstance(concepts, list) or not concepts:
                raise ValueError(f"{key}: missing structured concepts")
            for concept in concepts:
                if not isinstance(concept, dict) or any(not isinstance(concept.get(field), str) or not concept[field].strip() for field in ("title", "body")):
                    raise ValueError(f"{key}: concepts require nonempty title and body")
            if "learningGuide" in lesson:
                validate_learning_guide(lesson["learningGuide"], key)
            variants = lesson.get("codeVariants", [])
            if not isinstance(variants, list):
                raise ValueError(f"{key}: codeVariants must be a list")
            variant_ids = set()
            for variant in variants:
                if not isinstance(variant, dict) or any(not isinstance(variant.get(field), str) or not variant[field].strip() for field in ("id", "label", "lang", "code")):
                    raise ValueError(f"{key}: code variants require id, label, lang, and code")
                if not re.fullmatch(r"[a-z0-9-]+", variant["id"]) or variant["id"] in variant_ids:
                    raise ValueError(f"{key}: invalid or duplicate code variant id")
                variant_ids.add(variant["id"])
            options, answer = lesson.get("opts"), lesson.get("answer")
            if not isinstance(options, list) or len(options) < 2 or type(answer) is not int or not 0 <= answer < len(options):
                raise ValueError(f"{key}: invalid quiz options or answer index")
            rubric = lesson.get("rubric", [])
            if not rubric or sum(item[1] for item in rubric) != 100:
                raise ValueError(f"{key}: rubric must total 100 points")
            if not isinstance(lesson.get("sources"), list) or not lesson["sources"]:
                raise ValueError(f"{key}: at least one official source is required")
            for source in lesson["sources"]:
                if not isinstance(source, dict) or not source.get("title") or not str(source.get("url", "")).startswith("https://"):
                    raise ValueError(f"{key}: sources require a title and HTTPS URL")



def validate_learning_guide(guide: dict, key: str) -> None:
    def fields(value: object, names: tuple[str, ...]) -> None:
        if not isinstance(value, dict) or any(not isinstance(value.get(name), str) or not value[name].strip() for name in names):
            raise ValueError(f"{key}: learningGuide requires {names}")
    fields(guide, ("intro",))
    fields(guide.get("analogy"), ("familiar", "meaning", "limit"))
    for values, names, minimum in [(guide.get("vocabulary"), ("term", "definition"), 3),
                                    (guide.get("checkpoints"), ("question", "answer"), 2)]:
        if not isinstance(values, list) or len(values) < minimum:
            raise ValueError(f"{key}: missing learningGuide examples or definitions")
        for value in values:
            fields(value, names)
    case = guide.get("workedCase")
    fields(case, ("title", "input", "output", "why"))
    if not isinstance(case.get("steps"), list) or len(case["steps"]) < 3:
        raise ValueError(f"{key}: worked case needs at least three explained steps")
    for step in case["steps"]:
        fields(step, ("title", "explanation"))
    support = guide.get("levelSupport")
    if not isinstance(support, dict):
        raise ValueError(f"{key}: learningGuide needs support for three levels")
    for level in ("beginner", "intermediate", "advanced"):
        fields(support.get(level), ("title", "body", "task"))


def register_fonts(symbol_font: Path = SYMBOL_FONT) -> None:
    for name, filename in (("STRegular", "BeVietnamPro-Regular.ttf"), ("STBold", "BeVietnamPro-Bold.ttf")):
        font = TTFont(name, str(FONTS / filename))
        pdfmetrics.registerFont(font)
        _font_faces[name] = font.face
    if not symbol_font.is_file():
        raise ValueError("Scientific symbol font missing; install fonts-dejavu-core or pass --symbol-font /path/to/DejaVuSans.ttf")
    symbol = TTFont("STSymbols", str(symbol_font))
    pdfmetrics.registerFont(symbol)
    _font_faces["STSymbols"] = symbol.face
    pdfmetrics.registerFontFamily("STRegular", normal="STRegular", bold="STBold", italic="STRegular", boldItalic="STBold")


def markup(text: object, bold: bool = False) -> str:
    """Escape user text and use an embedded symbol font only where necessary."""
    primary = "STBold" if bold else "STRegular"
    chunks = []
    font = primary
    chunk = []
    for char in str(text):
        target = primary if ord(char) in _font_faces[primary].charToGlyph or char.isspace() else "STSymbols"
        if target == "STSymbols" and ord(char) not in _font_faces[target].charToGlyph:
            raise ValueError(f"PDF fonts do not contain {char!r} U+{ord(char):04X}")
        if target != font:
            if chunk:
                value = escape("".join(chunk))
                chunks.append(value if font == primary else f'<font name="{font}">{value}</font>')
            chunk, font = [], target
        chunk.append(char)
    if chunk:
        value = escape("".join(chunk))
        chunks.append(value if font == primary else f'<font name="{font}">{value}</font>')
    return "".join(chunks)


def styles():
    sheet = getSampleStyleSheet()
    definitions = {
        "Body": dict(fontName="STRegular", fontSize=9.5, leading=15, textColor=TEXT, spaceAfter=7),
        "TitleST": dict(fontName="STBold", fontSize=25, leading=33, textColor=BRAND, spaceAfter=16),
        "Lesson": dict(fontName="STBold", fontSize=20, leading=27, textColor=BRAND, spaceAfter=12, keepWithNext=True),
        "SectionST": dict(fontName="STBold", fontSize=12, leading=18, textColor=BRAND, spaceBefore=11, spaceAfter=7, keepWithNext=True),
        "Concept": dict(fontName="STBold", fontSize=10, leading=15, textColor=TEXT, spaceBefore=5, spaceAfter=4, keepWithNext=True),
        "SmallST": dict(fontName="STRegular", fontSize=8, leading=12, textColor=MUTED, spaceAfter=5),
        "CodeST": dict(fontName="STRegular", fontSize=8, leading=12, textColor=TEXT, backColor=colors.HexColor("#eef2f7"), borderPadding=8, spaceBefore=5, spaceAfter=10),
        "CoverNote": dict(fontName="STRegular", fontSize=11, leading=18, textColor=MUTED, spaceAfter=14),
    }
    for name, properties in definitions.items():
        sheet.add(ParagraphStyle(name=name, **properties))
    return sheet


def wrap_code(code: str, width: float, font_size: float = 8) -> str:
    """Wrap long lines at measured glyph widths without dropping source text."""
    result = []
    for line in code.expandtabs(4).splitlines():
        current = ""
        for char in line:
            font = "STRegular" if ord(char) in _font_faces["STRegular"].charToGlyph else "STSymbols"
            next_width = sum(pdfmetrics.stringWidth(c, "STRegular" if ord(c) in _font_faces["STRegular"].charToGlyph else "STSymbols", font_size) for c in current)
            if current and next_width + pdfmetrics.stringWidth(char, font, font_size) > width:
                result.append(current)
                current = "    "
            current += char
        result.append(current)
    return "\n".join(result)


def render_pdf(course: dict) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm,
                            title=f"{course['name']} · Giáo trình 6 bài", author="ST-Robot", creator="ST-Robot curriculum builder")
    sheet, story = styles(), []

    def para(value, style="Body"):
        story.append(Paragraph(markup(value, style in {"TitleST", "Lesson", "SectionST", "Concept"}).replace("\n", "<br/>"), sheet[style]))

    def section(title, value=None):
        para(title, "SectionST")
        if value:
            for text in str(value).split("\n\n"):
                para(text)

    def listing(items):
        for index, value in enumerate(items, 1):
            para(f"{index}. {value}")

    para("ST-ROBOT · TÀI LIỆU TỰ HỌC", "SmallST")
    para(course["name"], "TitleST")
    para(course["desc"], "CoverNote")
    para("6 bài học · Lý thuyết, ví dụ, thực hành, kiểm tra và tài liệu tham khảo", "CoverNote")
    story.append(HRFlowable(width="100%", color=BRAND, thickness=1))
    section("Lộ trình học tập")
    listing([lesson["title"] for lesson in course["lessons"]])
    section("Cách sử dụng tài liệu", "Đọc mục tiêu và kiến thức nền; tự dự đoán trước ví dụ; thực hành theo các bước; ghi lại dữ liệu và giải thích sai lệch. Sau khi tự làm, đối chiếu đáp án và tự kiểm tra. Phòng lab bên ngoài không tự đồng bộ điểm; hoạt động mô phỏng không thay thế kiểm tra an toàn phần cứng thật.")
    for index, lesson in enumerate(course["lessons"], 1):
        story.append(PageBreak())
        para(f"Bài {index}/6 · {lesson['title']}", "Lesson")
        para(lesson["goal"], "CoverNote")
        section("Chuẩn bị", lesson["prereq"])
        if lesson.get("objectives"):
            section("Sau bài học, bạn có thể")
            listing(lesson["objectives"])
        guide = lesson.get("learningGuide")
        if guide:
            section("Cùng hiểu bài từ đầu", guide["intro"])
            para(guide["analogy"]["familiar"], "Concept")
            para(guide["analogy"]["meaning"])
            para("Giới hạn của ví von: " + guide["analogy"]["limit"], "SmallST")
            section("Những từ cần hiểu")
            listing([item["term"] + ": " + item["definition"] for item in guide["vocabulary"]])
            case = guide["workedCase"]
            section(case["title"], "Bắt đầu với: " + case["input"])
            for step in case["steps"]:
                para(step["title"], "Concept")
                para(step["explanation"])
            para("Kết quả: " + case["output"])
            para(case["why"])
            section("Tự giải thích rồi đối chiếu")
            for checkpoint in guide["checkpoints"]:
                para(checkpoint["question"], "Concept")
                para(checkpoint["answer"])
            section("Chọn độ sâu phù hợp")
            for label, level in [("Mới bắt đầu", "beginner"), ("Đã học cơ bản", "intermediate"), ("Muốn tìm hiểu sâu", "advanced")]:
                support = guide["levelSupport"][level]
                para(label + " · " + support["title"], "Concept")
                para(support["body"])
                para(support["task"])
        section("Kiến thức trọng tâm")
        concepts = lesson.get("concepts", [])
        if concepts:
            for concept in concepts:
                para(concept["title"], "Concept")
                for text in concept["body"].split("\n\n"):
                    para(text)
        else:
            for text in lesson["theory"].split("\n\n"):
                para(text)
        section("Ví dụ có lời giải", lesson["example"])
        if lesson.get("misconceptions"):
            section("Lỗi thường gặp và cách tránh")
            listing(lesson["misconceptions"])
        section("Các bước thực hành")
        listing(lesson["steps"])
        section("Mã mẫu · " + lesson.get("lang", "Mã nguồn"))
        code = wrap_code(lesson["code"], doc.width - 16)
        story.append(XPreformatted(markup(code), sheet["CodeST"]))
        for variant in lesson.get("codeVariants", []):
            section(f"{variant['label']} · {variant['lang']}")
            code = wrap_code(variant["code"], doc.width - 16)
            story.append(XPreformatted(markup(code), sheet["CodeST"]))
        section("Chọn và sử dụng phòng lab", lesson["labGuide"])
        section("Bài tập áp dụng", lesson["exercise"])
        section("Gợi ý đối chiếu sau khi tự làm", lesson["solution"])
        if lesson.get("selfCheck"):
            section("Tự kiểm tra mức hiểu")
            listing(lesson["selfCheck"])
        section("Câu hỏi trắc nghiệm", lesson["q"])
        listing(lesson["opts"])
        para(f"Đáp án: {lesson['answer'] + 1}. {lesson['why']}")
        section("Tiêu chí đối chiếu thực hành")
        listing([f"{label}: {score} điểm" for label, score in lesson["rubric"]])
        if lesson.get("sources"):
            section("Tài liệu tham khảo chính thức")
            for source in lesson["sources"]:
                para(source["title"], "SmallST")
                story.append(Paragraph(f'<link href="{escape(source["url"], quote=True)}" color="#0f766e">{markup(source["url"])}</link>', sheet["SmallST"]))

    def decorate(pdf, document):
        pdf.saveState()
        pdf.setStrokeColor(colors.HexColor("#d5dde8"))
        pdf.line(doc.leftMargin, A4[1] - 13 * mm, A4[0] - doc.rightMargin, A4[1] - 13 * mm)
        pdf.setFont("STRegular", 8)
        pdf.setFillColor(MUTED)
        pdf.drawString(doc.leftMargin, A4[1] - 10 * mm, f"ST-Robot · {course['name']}")
        pdf.drawRightString(A4[0] - doc.rightMargin, 11 * mm, f"Trang {document.page}")
        pdf.restoreState()

    def deterministic_canvas(*args, **kwargs):
        kwargs["invariant"] = 1
        return canvas.Canvas(*args, **kwargs)

    doc.build(story, onFirstPage=decorate, onLaterPages=decorate, canvasmaker=deterministic_canvas)
    return buffer.getvalue()


def build_outputs(courses: list[dict]) -> dict[Path, bytes]:
    generated = "// Generated by scripts/build-learning-content.py; edit ai-server/curriculum.json.\n"
    curriculum = generated + "window.STROBOT_CURRICULUM = " + json.dumps(courses, ensure_ascii=False, indent=2) + ";\n"
    pdfs = {course["id"]: base64.b64encode(render_pdf(course)).decode("ascii") for course in courses}
    pdf_script = generated + "window.STROBOT_PDFS = " + json.dumps(pdfs, separators=(",", ":")) + ";\n"
    summaries = [{key: course[key] for key in ("id", "name", "tag", "desc", "tools")} | {"lessonCount": len(course["lessons"])} for course in courses]
    catalog = generated + "export const courses = " + json.dumps(summaries, ensure_ascii=False, indent=2) + ";\n"
    return {OUTPUT / "curriculum.js": curriculum.encode(), OUTPUT / "lesson-pdfs.js": pdf_script.encode(), OUTPUT / "courses.js": catalog.encode()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when committed generated files are missing or stale; do not write")
    parser.add_argument("--symbol-font", type=Path, default=SYMBOL_FONT, help="TTF containing Greek and scientific symbols")
    args = parser.parse_args()
    try:
        courses = json.loads(SOURCE.read_text())
        validate_courses(courses)
        register_fonts(args.symbol_font)
        outputs = build_outputs(courses)
        stale = []
        for path, content in outputs.items():
            if args.check:
                if not path.is_file() or path.read_bytes() != content:
                    stale.append(str(path.relative_to(ROOT)))
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
        if stale:
            print("Generated learning content is stale:\n" + "\n".join(stale), file=sys.stderr)
            return 1
        print(f"{'Verified' if args.check else 'Built'} {len(courses)} courses, {sum(len(c['lessons']) for c in courses)} lessons and {len(courses)} PDFs.")
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Cannot build learning content: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
