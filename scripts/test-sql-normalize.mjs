import fs from "fs";

function unwrapExtendedJson(val) {
  if (val == null || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(unwrapExtendedJson);
  if (Object.prototype.hasOwnProperty.call(val, "$numberInt")) return Number(val.$numberInt);
  if (Object.prototype.hasOwnProperty.call(val, "$numberLong")) return Number(val.$numberLong);
  if (Object.prototype.hasOwnProperty.call(val, "$numberDouble")) return Number(val.$numberDouble);
  if (Object.prototype.hasOwnProperty.call(val, "$oid")) return String(val.$oid);
  const out = {};
  for (const [k, v] of Object.entries(val)) out[k] = unwrapExtendedJson(v);
  return out;
}

function parseEmbeddedJsonField(val) {
  if (typeof val !== "string") return val;
  const t = val.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return val;
  try {
    return unwrapExtendedJson(JSON.parse(t));
  } catch {
    return val;
  }
}

function normalizeStudentRec(rec) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return rec;
  const r = unwrapExtendedJson(rec);
  r.questions = parseEmbeddedJsonField(r.questions);
  r.ai_questions = parseEmbeddedJsonField(r.ai_questions);
  if (Array.isArray(r.ai_questions)) r.ai_questions = unwrapExtendedJson(r.ai_questions);
  return r;
}

function extractShort(rec) {
  const qs = {};
  for (const q of rec.ai_questions || []) {
    if (q.ai_mode !== 2) continue;
    const total = Number(q.total_score || 0);
    if (total <= 0) continue;
    qs[String(q.question_no)] = Number(q.score || 0);
  }
  return qs;
}

const sqlPath = process.argv[2] || "E:/Tmp/inbox/shot_answer/phy/sql.json";
const sql = JSON.parse(fs.readFileSync(sqlPath, "utf8"));
let n = 0;
const qnos = new Set();
for (const raw of sql) {
  const r = normalizeStudentRec(raw);
  const qs = extractShort(r);
  if (Object.keys(qs).length) {
    n += 1;
    Object.keys(qs).forEach((k) => qnos.add(k));
  }
}
console.log("short records", n, "of", sql.length, "qnos", [...qnos].sort((a, b) => a - b));
