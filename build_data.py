# -*- coding: utf-8 -*-
"""Extract ai_mode=1 fill-in questions into compact exam.js for the viewer."""
from __future__ import annotations

import glob
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DPI = 200
OUT = ROOT / "data" / "exam.js"


def mm_to_px(mm: float) -> int:
    return max(0, round(float(mm) * DPI / 25.4))


def parse_ref(answers):
    img, text = "", ""
    for item in answers or []:
        if not isinstance(item, str):
            continue
        if item.startswith("http://") or item.startswith("https://"):
            img = item
        elif item.strip():
            text = item.replace("\\degree", "°")
    return img, text


def union_pos(boxes):
    xs, ys = [], []
    for box in boxes:
        if not box or len(box) < 4:
            continue
        x, y, w, h = [float(v) for v in box[:4]]
        xs.extend([x, x + w])
        ys.extend([y, y + h])
    if not xs:
        return None
    x0, y0 = min(xs), min(ys)
    return [round(x0, 4), round(y0, 4), round(max(xs) - x0, 4), round(max(ys) - y0, 4)]


def inflate(pos, pad, page_w, page_h):
    x, y, w, h = pos
    x = max(0.0, x - pad)
    y = max(0.0, y - pad)
    r = min(page_w, x + w + 2 * pad)
    b = min(page_h, y + h + 2 * pad)
    return [round(x, 4), round(y, 4), round(max(1.0, r - x), 4), round(max(1.0, b - y), 4)]


def main():
    files = sorted(ROOT.glob("*.json"))
    files = [p for p in files if p.name[:6].isdigit()]
    students = []
    exam_id = ""
    task_id = ""
    q_meta = defaultdict(lambda: {
        "id": "",
        "type": 3,
        "aiMode": 1,
        "totalScore": 0,
        "blankCount": 0,
        "refAnswers": [],
        "pos": None,
    })

    for path in files:
        rec = json.loads(path.read_text(encoding="utf-8"))
        exam_id = rec.get("exam_id") or exam_id
        task_id = rec.get("pre_task_id") or rec.get("task_id") or task_id
        page_w = float(rec.get("width") or 0)
        page_h = float(rec.get("height") or 0)
        grouped = defaultdict(list)
        for q in rec.get("ai_questions") or []:
            if q.get("ai_mode") != 1:
                continue
            grouped[int(q.get("question_no") or 0)].append(q)

        qs = {}
        for qno, segs in grouped.items():
            segs = sorted(segs, key=lambda s: s.get("unique_question_no") or 0)
            blanks = []
            pos_boxes = []
            score = 0.0
            total = 0.0
            qid = ""
            qtype = 3
            for seg in segs:
                qid = seg.get("question_id") or qid
                qtype = seg.get("question_type") or qtype
                total = max(total, float(seg.get("total_score") or 0))
                score += float(seg.get("score") or 0)
                if seg.get("pos"):
                    pos_boxes.append(seg["pos"])
                for blank in seg.get("score_list") or []:
                    pos = blank.get("pos") or []
                    ref_img, ref_text = parse_ref(blank.get("answers"))
                    total_b = float(blank.get("total_score") or 0)
                    score_b = float(blank.get("score") or 0)
                    right = blank.get("is_right")
                    if right is None:
                        right = total_b > 0 and score_b >= total_b
                    blanks.append({
                        "pos": [round(float(v), 4) for v in pos[:4]] if len(pos) >= 4 else [],
                        "right": bool(right),
                        "score": score_b,
                        "total": total_b,
                        "user": blank.get("user_answer") or "",
                        "ref": ref_text,
                        "refImg": ref_img,
                    })
                    if pos:
                        pos_boxes.append(pos)

            # Split regions share one total; don't double-count empty stem pieces.
            if len(segs) > 1:
                scored = [s for s in segs if s.get("score_list")]
                if scored:
                    score = sum(float(s.get("score") or 0) for s in scored)
                    total = max(float(s.get("total_score") or 0) for s in scored)
                    pos_boxes = [s["pos"] for s in scored if s.get("pos")]
                    for b in blanks:
                        if b.get("pos"):
                            pos_boxes.append(b["pos"])

            pos = union_pos(pos_boxes) or [0, 0, page_w, page_h]
            pos = inflate(pos, 2.0, page_w, page_h)
            qs[str(qno)] = {
                "score": round(score, 2),
                "total": round(total, 2),
                "pos": pos,
                "blanks": blanks,
            }

            meta = q_meta[qno]
            meta["id"] = qid or meta["id"]
            meta["type"] = qtype
            meta["aiMode"] = 1
            meta["totalScore"] = max(meta["totalScore"], total)
            meta["blankCount"] = max(meta["blankCount"], len(blanks))
            if not meta["refAnswers"] and blanks:
                meta["refAnswers"] = [b["ref"] for b in blanks]
                meta["pos"] = pos

        students.append({
            "stuNo": rec.get("stu_no") or "",
            "studentId": rec.get("student_id") or "",
            "scanId": rec.get("stuScanId") or rec.get("_id") or "",
            "page": rec.get("page") or 1,
            "width": page_w,
            "height": page_h,
            "image": rec.get("image") or "",
            "origin": rec.get("origin") or "",
            "file": path.name,
            "qs": qs,
        })

    students.sort(key=lambda s: s.get("file") or s["stuNo"])
    questions = []
    for qno in sorted(q_meta):
        meta = q_meta[qno]
        questions.append({
            "no": qno,
            "id": meta["id"],
            "type": meta["type"],
            "aiMode": 1,
            "label": "填空题",
            "blankCount": meta["blankCount"],
            "totalScore": meta["totalScore"],
            "refAnswers": meta["refAnswers"],
            "pos": meta["pos"],
        })

    payload = {
        "examId": exam_id,
        "taskId": task_id,
        "dpi": DPI,
        "mmPerInch": 25.4,
        "questions": questions,
        "students": students,
    }

    OUT.parent.mkdir(exist_ok=True)
    text = "window.EXAM_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({len(text) / 1024:.1f} KB) questions={len(questions)} students={len(students)}")


if __name__ == "__main__":
    main()
