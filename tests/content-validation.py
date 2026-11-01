#!/usr/bin/env python3
"""Validate generated browser data and real downloadable lesson PDFs.

Run: python3 tests/content-validation.py
Requires reportlab and pypdf; no browser, credentials, or network calls.
"""
from __future__ import annotations

import base64
import io
import json
import runpy
import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]


def load_assignment(path: Path, marker: str):
    source = path.read_text()
    return json.loads(source.split(marker, 1)[1].strip().removesuffix(";"))


def normalize(value: str) -> str:
    return " ".join(value.split())


def main() -> None:
    namespace = runpy.run_path(str(ROOT / "scripts/build-learning-content.py"))
    courses = json.loads((ROOT / "ai-server/curriculum.json").read_text())
    namespace["validate_courses"](courses)
    browser_data = load_assignment(ROOT / "frontend/src/data/curriculum.js", "window.STROBOT_CURRICULUM = ")
    assert browser_data == courses, "Browser and AI server curricula differ"
    summaries = load_assignment(ROOT / "frontend/src/data/courses.js", "export const courses = ")
    assert [item["id"] for item in summaries] == [item["id"] for item in courses], "Catalog courses do not match curriculum"
    pdfs = load_assignment(ROOT / "frontend/src/data/lesson-pdfs.js", "window.STROBOT_PDFS = ")
    assert set(pdfs) == {course["id"] for course in courses}, "Missing or extra course PDFs"
    total_pages = 0
    for course, summary in zip(courses, summaries):
        assert summary["lessonCount"] == len(course["lessons"])
        for field in ("name", "tag", "desc", "tools"):
            assert summary[field] == course[field], (course["id"], field, "stale catalog summary")
        data = base64.b64decode(pdfs[course["id"]], validate=True)
        assert data.startswith(b"%PDF-"), (course["id"], "invalid PDF bytes")
        document = PdfReader(io.BytesIO(data))
        assert len(document.pages) >= 7, (course["id"], "course PDF does not contain six lessons")
        text = normalize("\n".join(page.extract_text() for page in document.pages))
        total_pages += len(document.pages)
        assert normalize(course["name"]) in text
        for lesson in course["lessons"]:
            key = f"{course['id']}/{lesson['id']}"
            for field in ("title", "goal", "example", "exercise", "solution", "q", "why"):
                assert normalize(lesson[field]) in text, (key, field, "missing or outdated PDF content")
            for option in lesson["opts"]:
                assert normalize(option) in text, (key, "missing quiz option")
            for field in ("objectives", "misconceptions", "selfCheck"):
                for value in lesson.get(field, []):
                    assert normalize(value) in text, (key, field, "missing PDF teaching content")
            for concept in lesson.get("concepts", []):
                assert normalize(concept["title"]) in text, (key, "missing concept title")
                assert normalize(concept["body"]) in text, (key, "missing concept explanation")
            for source in lesson.get("sources", []):
                assert normalize(source["title"]) in text, (key, "missing source title")
                assert normalize(source["url"]) in text, (key, "missing source URL")
            for variant in lesson.get("codeVariants", []):
                assert normalize(variant["label"]) in text, (key, "missing alternative code label")
                assert normalize(variant["lang"]) in text, (key, "missing alternative code language")
                for line in variant["code"].splitlines():
                    if line.strip() and len(line) <= 100:
                        assert normalize(line) in text, (key, variant["id"], "missing alternative code line", line)
            scientific_text = " ".join([lesson["example"], lesson["code"], *(item["body"] for item in lesson.get("concepts", [])), *(item["code"] for item in lesson.get("codeVariants", []))])
            for symbol in set(scientific_text) & set("ΩπθωμµΔ→≤≥≠≈×²−"):
                assert symbol in text, (key, "missing scientific symbol in PDF", symbol)
        print(f"PASS {course['id']}: six lessons, {len(document.pages)} PDF pages, current explanations and quiz answers")
    subprocess.run([sys.executable, str(ROOT / "scripts/build-learning-content.py"), "--check"], cwd=ROOT, check=True)
    print(f"PASS {len(courses)} synchronized courses, {sum(len(c['lessons']) for c in courses)} lessons, {total_pages} readable PDF pages")


if __name__ == "__main__":
    main()
