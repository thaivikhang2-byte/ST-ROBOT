// One-time migration of authored source material; does not create students or results.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../.phase3-backup/phase5-baseline-20261023/frontend-public/course.learning.html'), 'utf8');
const start = source.indexOf('const COURSES=') + 'const COURSES='.length;
const courses = JSON.parse(source.slice(start, source.indexOf('\n];', start) + 2));
const pdfStart = source.indexOf('const PDFS=') + 'const PDFS='.length;
const pdfs = JSON.parse(source.slice(pdfStart, source.indexOf(";\n'use strict';", pdfStart)));
const target = path.resolve(__dirname, '../prisma/content');
fs.mkdirSync(path.join(target, 'pdf'), { recursive: true });
for (const course of courses) {
  if (!/^[a-z0-9-]+$/.test(course.id) || course.lessons.length !== 6) throw new Error('Unexpected authored content');
  const pdf = Buffer.from(pdfs[course.id], 'base64');
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid reference PDF');
  fs.writeFileSync(path.join(target, 'pdf', course.id + '.pdf'), pdf);
}
fs.writeFileSync(path.join(target, 'strobot-catalog.json'), JSON.stringify(courses, null, 2) + '\n');
const vm = require('node:vm');
const bankSource = fs.readFileSync(path.resolve(__dirname, '../../.phase3-backup/phase5-baseline-20261023/frontend-src/data/quiz.js'), 'utf8');
const bank = vm.runInNewContext(bankSource.replace('export const quizQuestions =', ''), Object.create(null), { timeout: 100 });
fs.writeFileSync(path.join(target, 'strobot-question-bank.json'), JSON.stringify(bank, null, 2) + '\n');
console.log(`Extracted ${courses.length} courses/${courses.reduce((sum, c) => sum + c.lessons.length, 0)} lessons and reference PDFs into backend-only content.`);
