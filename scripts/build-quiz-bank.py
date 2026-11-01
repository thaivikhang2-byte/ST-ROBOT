#!/usr/bin/env python3
"""Build the course/lesson quiz bank without changing the approved curriculum.

Each lesson supplies its approved question plus two authored additions from
frontend/src/data/quiz-extra.json. The generated ES module is committed so the
website needs no Python or network access to start a quiz.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURRICULUM = ROOT / "ai-server/curriculum.json"
EXTRAS = ROOT / "frontend/src/data/quiz-extra.json"
OUTPUT = ROOT / "frontend/src/data/quiz.js"


def nonempty(value: object, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context}: expected nonempty text")
    return value


def normalized(value: str) -> str:
    return " ".join(value.split()).casefold()


def build() -> tuple[list[dict], list[dict]]:
    curriculum = json.loads(CURRICULUM.read_text())
    extras = json.loads(EXTRAS.read_text())
    if not isinstance(curriculum, list) or not curriculum:
        raise ValueError("Curriculum must contain courses")
    if not isinstance(extras, list):
        raise ValueError("Additional questions must be a list")

    courses, approved = [], []
    lesson_keys, course_ids = set(), set()
    for course in curriculum:
        cid = nonempty(course.get("id"), "Course ID")
        if cid in course_ids:
            raise ValueError(f"Duplicate course: {cid}")
        course_ids.add(cid)
        lessons = []
        for lesson in course["lessons"]:
            lid = nonempty(lesson.get("id"), f"{cid} lesson ID")
            if (cid, lid) in lesson_keys:
                raise ValueError(f"Duplicate lesson: {cid}/{lid}")
            lesson_keys.add((cid, lid))
            lessons.append({"id": lid, "title": nonempty(lesson.get("title"), f"{cid}/{lid} title")})
            approved.append({
                "id": f"{cid}:{lid}:core", "courseId": cid, "lessonId": lid,
                "q": lesson["q"], "opts": lesson["opts"],
                "ans": lesson["answer"], "exp": lesson["why"],
            })
        courses.append({"id": cid, "name": nonempty(course.get("name"), f"{cid} name"), "lessons": lessons})

    extra_counts = Counter()
    extra_by_lesson: dict[tuple[str, str], list[dict]] = {}
    required_fields = {"id", "courseId", "lessonId", "q", "opts", "ans", "exp"}
    for question in extras:
        if not isinstance(question, dict) or set(question) != required_fields:
            raise ValueError("Additional questions must contain exactly id/courseId/lessonId/q/opts/ans/exp")
        key = (question["courseId"], question["lessonId"])
        if key not in lesson_keys:
            raise ValueError(f"Question references unknown lesson: {question.get('id')}")
        extra_counts[key] += 1
        extra_by_lesson.setdefault(key, []).append(question)
    for key in lesson_keys:
        if extra_counts[key] != 2:
            raise ValueError(f"{key[0]}/{key[1]} needs exactly two additional questions")

    questions, seen_ids, seen_text = [], set(), set()
    for original in approved:
        key = (original["courseId"], original["lessonId"])
        for question in [original, *extra_by_lesson[key]]:
            qid = nonempty(question.get("id"), "Question ID")
            if qid in seen_ids or not qid.startswith(f"{key[0]}:{key[1]}:"):
                raise ValueError(f"Invalid/duplicate question ID: {qid}")
            seen_ids.add(qid)
            text = nonempty(question.get("q"), f"{qid} question")
            text_key = (*key, normalized(text))
            if text_key in seen_text:
                raise ValueError(f"Duplicate question text within lesson: {qid}")
            seen_text.add(text_key)
            opts = question.get("opts")
            if not isinstance(opts, list) or not 3 <= len(opts) <= 4:
                raise ValueError(f"{qid}: expected three or four choices")
            choices = [normalized(nonempty(option, f"{qid} choice")) for option in opts]
            if len(set(choices)) != len(choices):
                raise ValueError(f"{qid}: duplicate choices")
            answer = question.get("ans")
            if type(answer) is not int or not 0 <= answer < len(opts):
                raise ValueError(f"{qid}: answer index does not identify a choice")
            nonempty(question.get("exp"), f"{qid} explanation")
            questions.append({field: question[field] for field in ("id", "courseId", "lessonId", "q", "opts", "ans", "exp")})

    counts = Counter((question["courseId"], question["lessonId"]) for question in questions)
    if set(counts) != lesson_keys or any(count != 3 for count in counts.values()):
        raise ValueError("Every lesson must have exactly three questions")
    return courses, questions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail when generated quiz.js is outdated")
    args = parser.parse_args()
    courses, questions = build()
    content = (
        "// Generated by scripts/build-quiz-bank.py; edit quiz-extra.json or the approved curriculum.\n"
        "export const quizCourses = " + json.dumps(courses, ensure_ascii=False, indent=2) + ";\n\n"
        "export const quizQuestions = " + json.dumps(questions, ensure_ascii=False, indent=2) + ";\n"
    )
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text() != content:
            raise SystemExit("Quiz bank is stale; run python3 scripts/build-quiz-bank.py")
        action = "Verified"
    else:
        OUTPUT.write_text(content)
        action = "Built"
    lesson_count = sum(len(course["lessons"]) for course in courses)
    print(f"{action} {len(courses)} courses, {lesson_count} lessons, {len(questions)} scoped questions")


if __name__ == "__main__":
    main()
