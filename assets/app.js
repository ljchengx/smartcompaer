(function () {
  const DPI = 200;
  const MM_PER_INCH = 25.4;
  window.EXAM_DATA = window.EXAM_DATA || { examId: "", taskId: "", dpi: DPI, questions: [], students: [] };

  const OPTION_LABELS = "ABCDEFGH".split("");

  const SERIES_COLORS = ["#17362d", "#2563eb", "#b9892d", "#8b5cf6", "#d4523e", "#0891b2"];

  const state = {
    examType: "fill",
    qIndex: 0,
    studentKey: "",
    filter: "all",
    taskFilter: "all",
    query: "",
    blankIndex: 0,
    zoom: 1.25,
    compareTasks: new Set(),
    folderPickAppend: false,
    jsonPickAppend: false,
  };

  let folderSourceSeq = 0;

  /** 以题面 pos 为基准，四周等距扩展（mm），不改变右侧列表布局 */
  const SLICE_VIEW_PAD_MM = 12;
  const SLICE_ZOOM_DEFAULT = 1.25;

  function examTypeLabel(type) {
    if (type === "choice") return "选择题";
    if (type === "short") return "简答题";
    return "填空题";
  }

  function answerIntToLetters(n) {
    const v = Number(n) || 0;
    let s = "";
    for (let i = 0; i < OPTION_LABELS.length; i += 1) {
      if (v & (1 << i)) s += OPTION_LABELS[i];
    }
    return s;
  }

  const $ = (id) => document.getElementById(id);

  function mmToPx(mm) {
    return Math.max(0, Math.round(Number(mm) * DPI / MM_PER_INCH));
  }

  function fmtPct(n) {
    return (Math.round(n * 1000) / 10).toFixed(1) + "%";
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function looksLikeLatex(raw) {
    const text = String(raw || "").trim();
    if (!text) return false;
    if (/[\u4e00-\u9fff]/.test(text) && !/\$|\\[a-zA-Z]/.test(text)) return false;
    if (/\$\$?/.test(text)) return true;
    return /\\(overset|frac|sqrt|frown|begin|left|right|text|sin|cos|tan|theta|alpha|beta|gamma|cdot|times|div|pm|circ|degree)\b/.test(text)
      || /[_^]\{|\\[a-zA-Z]+/.test(text);
  }

  function toKatexTex(raw) {
    let tex = String(raw || "").trim();
    tex = tex.replace(/^\$\$([\s\S]*)\$\$$/g, "$1");
    tex = tex.replace(/^\$([\s\S]*)\$$/g, "$1");
    tex = tex.replace(/\$\$/g, "").replace(/\$/g, "");
    return tex.trim();
  }

  function prettyAnswer(raw) {
    let text = String(raw || "").trim();
    if (!text) return "";
    text = text.replace(/\n\*注意[\s\S]*$/g, "").trim();
    text = toKatexTex(text);
    text = text.replace(/\\overset\s*\{\s*\\frown\s*\}\s*\{([^}]*)\}/g, "⌒$1");
    text = text.replace(/\\frown/g, "⌒");
    text = text.replace(/\\overset\s*\{([^}]*)\}\s*\{([^}]*)\}/g, "$2");
    text = text.replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, "$1/$2");
    text = text.replace(/\\degree/g, "°");
    text = text.replace(/\\circ/g, "°");
    text = text.replace(/\\times/g, "×");
    text = text.replace(/\\div/g, "÷");
    text = text.replace(/\\pm/g, "±");
    text = text.replace(/\\cdot/g, "·");
    text = text.replace(/\\left|\\right/g, "");
    text = text.replace(/\\text\s*\{([^}]*)\}/g, "$1");
    text = text.replace(/\\[a-zA-Z]+/g, "");
    text = text.replace(/[{}]/g, "");
    return text.replace(/[ \t]+/g, " ").replace(/\n+/g, "\n").trim();
  }

  function displayAnswer(value, blank) {
    const raw = String(value || "").trim();
    if (!raw) {
      if (blank && blank.right) return "判对";
      return "空白";
    }
    if (looksLikeLatex(raw) && window.katex) {
      try {
        const tex = toKatexTex(raw);
        if (tex) {
          return `<span class="math">${window.katex.renderToString(tex, {
            throwOnError: false,
            displayMode: false,
            strict: "ignore",
          })}</span>`;
        }
      } catch (err) {
        /* fall through to plain text */
      }
    }
    const text = prettyAnswer(raw);
    if (!text) return blank && blank.right ? "判对" : "空白";
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function parseAnswers(answers) {
    let img = "";
    let text = "";
    for (const item of answers || []) {
      if (typeof item !== "string") continue;
      if (item.startsWith("http://") || item.startsWith("https://")) img = item;
      else if (item.trim()) text = item.replace("\\degree", "°");
    }
    return { img, text };
  }

  function unionPos(boxes) {
    const xs = [];
    const ys = [];
    for (const box of boxes) {
      if (!box || box.length < 4) continue;
      const [x, y, w, h] = box.map(Number);
      xs.push(x, x + w);
      ys.push(y, y + h);
    }
    if (!xs.length) return null;
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0].map((v) => Math.round(v * 10000) / 10000);
  }

  function inflatePos(pos, pad, pageW, pageH) {
    const [x, y, w, h] = pos;
    const nx = Math.max(0, x - pad);
    const ny = Math.max(0, y - pad);
    const nr = Math.min(pageW, x + w + 2 * pad);
    const nb = Math.min(pageH, y + h + 2 * pad);
    return [nx, ny, Math.max(1, nr - nx), Math.max(1, nb - ny)].map((v) => Math.round(v * 10000) / 10000);
  }

  function extractQsChoice(rec) {
    const pageW = Number(rec.width || 0);
    const pageH = Number(rec.height || 0);
    const qs = {};
    for (const q of rec.questions || []) {
      if (!Array.isArray(q.list) || Number(q.total_score || 0) <= 0) continue;
      const qno = String(q.question_no || 0);
      if (!qno || qno === "0") continue;
      const score = Number(q.score || 0);
      const total = Number(q.total_score || 0);
      let right = total > 0 && score >= total;
      if (!right && q.detect_score != null && total > 0) {
        right = Number(q.detect_score) >= total;
      }
      const options = (q.list || []).map((opt, i) => ({
        letter: OPTION_LABELS[i] || String(i + 1),
        fill: !!(opt && opt.fill),
        pos: opt && Array.isArray(opt.pos) ? opt.pos.slice(0, 4) : [],
      }));
      const user = String(q.user_answer || "").trim() || answerIntToLetters(q.detect_answer_int);
      const ref = answerIntToLetters(q.answer_int);
      const posBoxes = [];
      if (q.pos && q.pos.length >= 4) posBoxes.push(q.pos);
      for (const opt of options) {
        if (opt.pos.length === 4) posBoxes.push(opt.pos);
      }
      const pos = inflatePos(unionPos(posBoxes) || [0, 0, pageW, pageH], 2, pageW, pageH);
      qs[qno] = {
        score: Math.round(score * 100) / 100,
        total: Math.round(total * 100) / 100,
        pos,
        blanks: [{
          right,
          user,
          ref,
          score,
          total,
          pos: [],
        }],
        options,
        multi: !!q.multi,
        questionType: q.question_type,
      };
    }
    return qs;
  }

  function extractQsFill(rec) {
    const pageW = Number(rec.width || 0);
    const pageH = Number(rec.height || 0);
    const grouped = {};
    for (const q of rec.ai_questions || []) {
      if (q.ai_mode !== 1) continue;
      const no = String(q.question_no || 0);
      (grouped[no] || (grouped[no] = [])).push(q);
    }
    const qs = {};
    for (const [qno, segsRaw] of Object.entries(grouped)) {
      const segs = segsRaw.slice().sort((a, b) => (a.unique_question_no || 0) - (b.unique_question_no || 0));
      const scored = segs.filter((s) => (s.score_list || []).length);
      const useSegs = scored.length ? scored : segs;
      const blanks = [];
      const posBoxes = [];
      let score = 0;
      let total = 0;
      for (const seg of useSegs) {
        total = Math.max(total, Number(seg.total_score || 0));
        score += Number(seg.score || 0);
        if (seg.pos) posBoxes.push(seg.pos);
        for (const blank of seg.score_list || []) {
          const totalB = Number(blank.total_score || 0);
          const scoreB = Number(blank.score || 0);
          let right = blank.is_right;
          if (right == null) right = totalB > 0 && scoreB >= totalB;
          const parsed = parseAnswers(blank.answers);
          const pos = Array.isArray(blank.pos) ? blank.pos.slice(0, 4) : [];
          blanks.push({
            pos,
            right: !!right,
            score: scoreB,
            total: totalB,
            user: blank.user_answer || "",
            ref: parsed.text,
            refImg: parsed.img,
          });
          if (pos.length === 4) posBoxes.push(pos);
        }
        if (!(seg.score_list || []).length) {
          const totalB = Number(seg.total_score || 0);
          if (totalB > 0) {
            const scoreB = Number(seg.score || 0);
            const pos = seg.pos && seg.pos.length >= 4 ? seg.pos.slice(0, 4) : [];
            blanks.push({
              pos,
              right: scoreB >= totalB - 0.001,
              score: scoreB,
              total: totalB,
              user: seg.user_answer || "",
              ref: "",
              refImg: "",
            });
            if (pos.length === 4) posBoxes.push(pos);
          }
        }
      }
      const pos = inflatePos(unionPos(posBoxes) || [0, 0, pageW, pageH], 2, pageW, pageH);
      qs[qno] = { score: Math.round(score * 100) / 100, total: Math.round(total * 100) / 100, pos, blanks };
    }
    return qs;
  }

  function extractQsShort(rec) {
    const pageW = Number(rec.width || 0);
    const pageH = Number(rec.height || 0);
    const qs = {};
    for (const q of rec.ai_questions || []) {
      if (q.ai_mode !== 2) continue;
      const total = Number(q.total_score || 0);
      if (total <= 0) continue;
      const qno = String(q.question_no || 0);
      if (!qno || qno === "0") continue;
      const score = Number(q.score || 0);
      const pos = q.pos && q.pos.length >= 4 ? q.pos : null;
      qs[qno] = {
        score: Math.round(score * 100) / 100,
        total: Math.round(total * 100) / 100,
        pos: pos || [0, 0, pageW, pageH],
        correctModel: q.correct_model,
        questionType: q.question_type,
      };
    }
    return qs;
  }

  function extractQs(rec) {
    if (state.examType === "choice") return extractQsChoice(rec);
    if (state.examType === "short") return extractQsShort(rec);
    return extractQsFill(rec);
  }

  function taskFolderFromPath(relPath, fallback) {
    const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    // …/{taskId}/detect/000xxx.json
    if (parts.length >= 3 && parts[parts.length - 2].toLowerCase() === "detect") {
      return parts[parts.length - 3];
    }
    // {taskId}/000xxx.json
    if (parts.length >= 2 && parts[0].toLowerCase() !== "detect") {
      return parts[0];
    }
    return fallback || "";
  }

  function studentFromRec(rec, relPath, sourceMeta) {
    const meta = sourceMeta || {};
    const sourceId = meta.sourceId || "";
    const sourceName = meta.sourceName || "";
    const path = String(relPath || "").replace(/\\/g, "/");
    const file = path.split("/").pop() || path;
    const fromJson = rec.pre_task_id || String(rec.task_id || "").split("_")[0] || "";
    const taskId = fromJson || taskFolderFromPath(path, "");
    const taskFolder = taskFolderFromPath(path, taskId) || taskId;
    const key = `${sourceId || "s0"}::${taskId || taskFolder || "task"}::${file}::${rec.stu_no || rec.student_id || rec.stuScanId || ""}`;
    const taskIdRaw = rec.task_id || rec.pre_task_id || "";
    const idx = rec.idx != null ? rec.idx : (rec.idx_num != null ? rec.idx_num : null);
    return {
      key,
      stuNo: rec.stu_no || "",
      studentId: rec.student_id || "",
      scanId: rec.stuScanId || rec._id || "",
      taskIdRaw,
      idx,
      page: rec.page || 1,
      width: Number(rec.width || 0),
      height: Number(rec.height || 0),
      image: rec.image || "",
      origin: rec.origin || "",
      file,
      path,
      taskId,
      taskFolder,
      sourceId,
      sourceName,
      qs: extractQs(rec),
      examId: rec.exam_id || "",
    };
  }

  function newFolderSourceId() {
    folderSourceSeq += 1;
    return `folder-${folderSourceSeq}`;
  }

  function shortFolderLabel(name) {
    const text = String(name || "").trim();
    if (!text) return "目录";
    if (text.length <= 14) return text;
    return "…" + text.slice(-13);
  }

  function buildQuestions(students) {
    const typeLabel = examTypeLabel(state.examType);
    const meta = {};
    for (const stu of students) {
      for (const [qno, rec] of Object.entries(stu.qs || {})) {
        if (!meta[qno]) {
          meta[qno] = {
            no: Number(qno),
            id: "",
            type: state.examType === "choice" ? 8 : (state.examType === "short" ? 6 : 3),
            aiMode: state.examType === "choice" ? 0 : (state.examType === "short" ? 2 : 1),
            label: typeLabel,
            blankCount: 0,
            optionCount: 0,
            totalScore: 0,
            refAnswers: [],
            refImages: [],
            pos: rec.pos,
          };
        }
        const blanks = rec.blanks || [];
        if (state.examType === "choice") {
          meta[qno].blankCount = 0;
          meta[qno].optionCount = Math.max(meta[qno].optionCount, (rec.options || []).length);
        } else if (state.examType === "short") {
          meta[qno].blankCount = 0;
        } else {
          meta[qno].blankCount = Math.max(meta[qno].blankCount, blanks.length);
        }
        meta[qno].totalScore = Math.max(meta[qno].totalScore, rec.total || 0);
        if (!meta[qno].pos && rec.pos) meta[qno].pos = rec.pos;
        if (blanks.length) {
          if (meta[qno].refAnswers.length < blanks.length) {
            meta[qno].refAnswers.length = blanks.length;
            meta[qno].refImages.length = blanks.length;
          }
          blanks.forEach((b, i) => {
            if (!meta[qno].refAnswers[i] && b.ref) meta[qno].refAnswers[i] = b.ref;
            if (!meta[qno].refImages[i] && b.refImg) meta[qno].refImages[i] = b.refImg;
          });
        }
      }
    }
    return Object.values(meta).sort((a, b) => a.no - b.no);
  }

  /** @type {{ id: string, name: string, handle: FileSystemDirectoryHandle|null, files: File[], bundleFile: File|null }[]} */
  const folderSources = [];

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
    } catch (_) {
      return val;
    }
  }

  /** 线上导出常把 ai_mode 题放在 questions，ai_questions 为空 */
  function syncAiQuestionsFromQuestions(r) {
    const list = Array.isArray(r.questions) ? r.questions : [];
    const ai = Array.isArray(r.ai_questions) ? r.ai_questions : [];
    if (ai.length) return;
    const picked = list.filter((q) => q && (Number(q.ai_mode) === 1 || Number(q.ai_mode) === 2));
    if (picked.length) r.ai_questions = picked;
  }

  /** Mongo / MySQL 导出：内嵌 JSON 字符串、Extended JSON 数字 */
  function normalizeStudentRec(rec) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return rec;
    const r = unwrapExtendedJson(rec);
    r.questions = parseEmbeddedJsonField(r.questions);
    r.ai_questions = parseEmbeddedJsonField(r.ai_questions);
    if (r.ai_questions == null) r.ai_questions = [];
    if (r.stu_no_detect != null) r.stu_no_detect = parseEmbeddedJsonField(r.stu_no_detect);
    if (Array.isArray(r.ai_questions)) r.ai_questions = unwrapExtendedJson(r.ai_questions);
    if (Array.isArray(r.questions)) r.questions = unwrapExtendedJson(r.questions);
    syncAiQuestionsFromQuestions(r);
    return r;
  }

  function parseRawStudentRecord(raw, relPath, sourceMeta) {
    const rec = normalizeStudentRec(raw);
    if (!isStudentRec(rec)) return null;
    return studentFromRec(rec, relPath, sourceMeta);
  }

  function isStudentRec(rec) {
    if (!rec || typeof rec !== "object") return false;
    if (rec.stu_no != null || rec.student_id != null) return true;
    if (state.examType === "choice") return Array.isArray(rec.questions);
    if (state.examType === "short") {
      return Array.isArray(rec.ai_questions) && (rec.ai_questions || []).some((q) => q.ai_mode === 2);
    }
    return Array.isArray(rec.ai_questions);
  }

  function hasParsedQuestions(stu) {
    return stu && stu.qs && Object.keys(stu.qs).length > 0;
  }

  function sortStudents(recs) {
    return recs.slice().sort((a, b) => {
      const ta = String(a.taskFolder || a.taskId || "");
      const tb = String(b.taskFolder || b.taskId || "");
      if (ta !== tb) return ta.localeCompare(tb, "en", { numeric: true });
      return String(a.file || "").localeCompare(String(b.file || ""), "en", { numeric: true });
    });
  }

  function buildSeries(students) {
    if (folderSources.length > 1) {
      return folderSources.map((src, i) => {
        const list = students.filter((s) => s.sourceId === src.id);
        return {
          id: src.id,
          label: shortFolderLabel(src.name),
          fullLabel: src.name,
          count: list.length,
          colorIndex: i,
          students: list,
        };
      });
    }
    const tasks = taskListOf(students);
    if (!tasks.length) {
      return [{ id: "all", label: "全部", students, colorIndex: 0 }];
    }
    if (tasks.length === 1) {
      return [{
        id: tasks[0].id,
        label: shortTask(tasks[0].id),
        fullLabel: tasks[0].id,
        count: tasks[0].count,
        colorIndex: 0,
        students,
      }];
    }
    return tasks.map((t, i) => ({
      id: t.id,
      label: shortTask(t.id),
      fullLabel: t.id,
      count: t.count,
      colorIndex: i,
      students: students.filter((s) => (s.taskFolder || s.taskId || "") === t.id),
    }));
  }

  function taskListOf(students) {
    const map = new Map();
    for (const stu of students) {
      const id = stu.taskFolder || stu.taskId || "";
      if (!id) continue;
      map.set(id, (map.get(id) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  }

  function applyStudents(recs, folderName, opts) {
    const loadOpts = opts || {};
    const students = sortStudents(recs);
    const tasks = taskListOf(students);
    if (state.taskFilter !== "all" && !tasks.some((t) => t.id === state.taskFilter)) {
      state.taskFilter = "all";
    }
    window.EXAM_DATA = {
      examId: students[0] ? students[0].examId : "",
      taskId: students[0] ? students[0].taskId : "",
      examType: state.examType,
      dpi: DPI,
      questions: buildQuestions(students),
      students,
      series: buildSeries(students),
      tasks,
      sources: folderSources.map((s) => ({ id: s.id, name: s.name })),
      loadedAt: new Date(),
      folderName: folderName || "",
    };
    state.compareTasks = new Set((window.EXAM_DATA.series || []).map((s) => s.id));
    const multiFolder = state.examType === "short" && folderSources.length > 1;
    const taskText = multiFolder
      ? ` · ${folderSources.length} 个对比目录`
      : tasks.length > 1
        ? ` · ${tasks.length} 个任务`
        : tasks.length === 1
          ? ` · 任务 ${tasks[0].id.slice(0, 8)}…`
          : "";
    const skipHint = loadOpts.extraSourcesSkipped ? " · 多目录对比仅简答题，已忽略其余目录" : "";
    $("folderMeta").textContent = students.length
      ? `${folderName}${taskText}${skipHint} · ${students.length} 份 JSON`
      : `${folderName || "已选文件夹"} · 没有可解析的${examTypeLabel(state.examType)} JSON`;
    $("reloadBtn").disabled = !folderSources.length;
    updateCompareFolderBtn(students.length);
    if ($("exportBtn")) $("exportBtn").disabled = !students.length;
    if (state.qIndex >= window.EXAM_DATA.questions.length) state.qIndex = 0;
    renderTaskFilter();
    renderFolderSourceChips();
  }

  function parseJsonFile(file, relPath, sourceMeta) {
    return file.text().then((text) => {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return null;
      return parseRawStudentRecord(parsed, relPath, sourceMeta);
    }).catch(() => null);
  }

  async function loadRecsFromJsonBundle(file, sourceMeta) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const base = file.name || "export.json";
    return list
      .map((raw, i) => parseRawStudentRecord(raw, `${base}#${i + 1}`, sourceMeta))
      .filter(Boolean)
      .filter(hasParsedQuestions);
  }

  async function collectJsonHandles(dirHandle, prefix) {
    const items = [];
    for await (const [name, handle] of dirHandle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        if (name.startsWith(".") || name === "assets" || name === "node_modules") continue;
        items.push(...await collectJsonHandles(handle, path));
      } else if (
        /\.json$/i.test(name)
        && !/^(package(-lock)?|tsconfig|exam|sql)\.json$/i.test(name)
      ) {
        items.push({ name, path, handle });
      }
    }
    return items;
  }

  async function loadRecsFromDirectoryHandle(dirHandle, sourceMeta) {
    const perm = await dirHandle.queryPermission({ mode: "read" });
    if (perm !== "granted") {
      const next = await dirHandle.requestPermission({ mode: "read" });
      if (next !== "granted") throw new Error("没有读取该文件夹的权限");
    }
    const items = await collectJsonHandles(dirHandle, "");
    items.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
    let recs = (await Promise.all(items.map(async (item) => {
      const file = await item.handle.getFile();
      return parseJsonFile(file, item.path, sourceMeta);
    }))).filter(Boolean);
    return recs.filter(hasParsedQuestions);
  }

  async function loadRecsFromFileList(fileList, sourceMeta) {
    const files = Array.from(fileList || []).filter((file) => {
      const name = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      const base = name.split("/").pop();
      return /\.json$/i.test(base) && !/^(package(-lock)?|tsconfig|exam|sql)\.json$/i.test(base);
    });
    files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "en", { numeric: true }));
    let recs = (await Promise.all(files.map((file) => {
      const rel = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      const parts = rel.split("/");
      const path = parts.length > 1 ? parts.slice(1).join("/") : rel;
      return parseJsonFile(file, path, sourceMeta);
    }))).filter(Boolean);
    return recs.filter(hasParsedQuestions);
  }

  async function loadAllFolderSources() {
    if (!folderSources.length) throw new Error("请先选择文件夹");
    const sources = state.examType === "short"
      ? folderSources
      : folderSources.slice(0, 1);
    const batches = [];
    for (const src of sources) {
      const meta = { sourceId: src.id, sourceName: src.name };
      let recs = [];
      if (src.bundleFile) recs = await loadRecsFromJsonBundle(src.bundleFile, meta);
      else if (src.handle) recs = await loadRecsFromDirectoryHandle(src.handle, meta);
      else if (src.files && src.files.length) recs = await loadRecsFromFileList(src.files, meta);
      if (!recs.length) {
        throw new Error(`「${src.name}」里没有可解析的${examTypeLabel(state.examType)} JSON`);
      }
      batches.push(...recs);
    }
    const folderName = sources.map((s) => s.name).join(" · ");
    applyStudents(batches, folderName, {
      extraSourcesSkipped: state.examType !== "short" && folderSources.length > 1,
    });
  }

  async function loadFolderData() {
    await loadAllFolderSources();
  }

  async function pickFolder({ append = false } = {}) {
    if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      if (!append) folderSources.length = 0;
      folderSources.push({
        id: newFolderSourceId(),
        name: handle.name,
        handle,
        files: [],
        bundleFile: null,
      });
      await loadAllFolderSources();
      return;
    }
    state.folderPickAppend = append;
    $("folderInput").click();
  }

  async function pickJsonBundle({ append = false } = {}) {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      if (!append) folderSources.length = 0;
      folderSources.push({
        id: newFolderSourceId(),
        name: file.name,
        handle: null,
        files: [],
        bundleFile: file,
      });
      await loadAllFolderSources();
      return;
    }
    state.jsonPickAppend = append;
    $("jsonFileInput").click();
  }

  async function pickCompareFolder() {
    if (state.examType !== "short") return;
    await pickFolder({ append: true });
  }

  function removeFolderSource(id) {
    const idx = folderSources.findIndex((s) => s.id === id);
    if (idx < 0) return;
    folderSources.splice(idx, 1);
    if (!folderSources.length) {
      window.EXAM_DATA = { examId: "", taskId: "", examType: state.examType, dpi: DPI, questions: [], students: [] };
      renderEmpty();
      return;
    }
    loadAllFolderSources().then(render).catch((err) => {
      console.error(err);
      $("folderMeta").textContent = "读取失败：" + (err.message || err);
    });
  }

  function renderFolderSourceChips() {
    const root = $("folderSourceChips");
    if (!root) return;
    if (state.examType !== "short" || !folderSources.length) {
      root.innerHTML = "";
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.innerHTML = folderSources.map((src, i) => `
      <span class="source-chip">
        <i style="background:${seriesColor(i)}"></i>
        <span title="${escapeHtml(src.name)}">${escapeHtml(shortFolderLabel(src.name))}</span>
        <button type="button" data-remove-source="${escapeHtml(src.id)}" aria-label="移除">×</button>
      </span>
    `).join("");
  }

  function ossCrop(url, pos) {
    if (!url || !pos || pos.length < 4) return url || "";
    const [x, y, w, h] = pos.map(mmToPx);
    const clean = url.split("?")[0];
    return `${clean}?x-oss-process=image/crop,x_${x},y_${y},w_${Math.max(1, w)},h_${Math.max(1, h)}`;
  }

  function supportsOssCrop(url) {
    if (!url) return false;
    try {
      const host = new URL(url, window.location.href).hostname.toLowerCase();
      return host.includes("aliyuncs.com") || host.includes("alicdn.com") || host.includes(".oss.");
    } catch (err) {
      return false;
    }
  }

  function sliceImageUrls(student) {
    const urls = [];
    if (student.image) urls.push(student.image);
    if (student.origin && student.origin !== student.image) urls.push(student.origin);
    return urls;
  }

  /** 题面矩形 pos 四边各加 padMm，贴页边时只裁掉超出部分，不整体平移视图 */
  function expandViewPos(pos, pageWmm, pageHmm, padMm) {
    const [x, y, w, h] = pos.map(Number);
    const pad = Math.max(0, Number(padMm) || 0);
    let vx = x - pad;
    let vy = y - pad;
    let vw = w + pad * 2;
    let vh = h + pad * 2;
    if (vx < 0) {
      vw += vx;
      vx = 0;
    }
    if (vy < 0) {
      vh += vy;
      vy = 0;
    }
    if (pageWmm > 0 && vx + vw > pageWmm) vw = pageWmm - vx;
    if (pageHmm > 0 && vy + vh > pageHmm) vh = pageHmm - vy;
    return [vx, vy, Math.max(1, vw), Math.max(1, vh)];
  }

  function clearSliceImgStyles(img) {
    img.classList.remove("slice-img--pan", "slice-img--fit");
    img.style.position = "";
    img.style.left = "";
    img.style.top = "";
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
  }

  function applyPanCrop(img, student, pos) {
    const [x, y, w, h] = pos.map(Number);
    const pageWmm = Number(student.width) || w;
    const pageHmm = Number(student.height) || h;

    const layout = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;
      const pxPerMmX = nw / pageWmm;
      const pxPerMmY = nh / pageHmm;
      const ix = x * pxPerMmX;
      const iy = y * pxPerMmY;
      const iw = Math.max(1, w * pxPerMmX);
      const ih = Math.max(1, h * pxPerMmY);
      img.classList.add("slice-img--pan");
      img.classList.remove("slice-img--fit");
      img.style.position = "absolute";
      img.style.maxWidth = "none";
      img.style.width = `${(nw / iw) * 100}%`;
      img.style.height = "auto";
      img.style.left = `${(-ix / iw) * 100}%`;
      img.style.top = `${(-iy / ih) * 100}%`;
    };

    if (img.complete && img.naturalWidth) layout();
    else img.addEventListener("load", layout, { once: true });
  }

  function renderChoiceTrack(options, blank) {
    const main = blank || {};
    const ref = String(main.ref || "");
    const pick = escapeHtml(String(main.user || "—"));
    const chips = (options || []).map((opt) => {
      let cls = "opt-chip";
      if (opt.fill) cls += ` filled ${main.right ? "ok" : "bad"}`;
      else if (ref.includes(opt.letter)) cls += " is-ref";
      return `<span class="${cls}">${escapeHtml(opt.letter)}</span>`;
    }).join("");
    return `<div class="choice-row"><span class="choice-pick ${main.right ? "ok" : "bad"}">${pick}</span><div class="opt-track">${chips}</div></div>`;
  }

  function recOf(stu, question) {
    return stu.qs[String(question.no)];
  }

  function activeStudents() {
    const all = window.EXAM_DATA.students || [];
    if (state.taskFilter === "all") return all;
    return all.filter((stu) => (stu.taskFolder || stu.taskId || "") === state.taskFilter);
  }

  function questionStats(question) {
    const students = activeStudents();
    let full = 0;
    let blankRight = 0;
    let blankTotal = 0;
    let scoreSum = 0;
    let scoreN = 0;
    for (const stu of students) {
      const rec = recOf(stu, question);
      if (!rec) continue;
      if (state.examType === "short") {
        scoreSum += Number(rec.score || 0);
        scoreN += 1;
        if (Number(rec.score) >= Number(rec.total) - 0.001) full += 1;
        continue;
      }
      const blanks = rec.blanks || [];
      if (blanks.length > 0 && blanks.every((b) => b.right)) full += 1;
      blankRight += blanks.filter((b) => b.right).length;
      blankTotal += blanks.length;
    }
    const total = students.length;
    return {
      full,
      total,
      studentRate: total ? full / total : 0,
      blankRate: blankTotal ? blankRight / blankTotal : 0,
      avgScore: scoreN ? scoreSum / scoreN : 0,
    };
  }

  function blankStats(question, index) {
    let right = 0;
    let total = 0;
    for (const stu of activeStudents()) {
      const rec = recOf(stu, question);
      const blank = rec && rec.blanks[index];
      if (!blank) continue;
      total += 1;
      if (blank.right) right += 1;
    }
    return { right, total, rate: total ? right / total : 0 };
  }

  function xmlEscape(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function taskScopeLabel() {
    if (state.taskFilter === "all") return "全部任务";
    return "任务 " + shortTask(state.taskFilter);
  }

  function refText(question, index) {
    const text = prettyAnswer((question.refAnswers || [])[index] || "");
    if (text) return text;
    if ((question.refImages || [])[index]) return "（图片）";
    return "";
  }

  function buildRateRows() {
    const questions = window.EXAM_DATA.questions || [];
    const rows = [];
    const isChoice = state.examType === "choice";
    for (const q of questions) {
      const count = isChoice ? 1 : (q.blankCount || 0);
      for (let i = 0; i < count; i += 1) {
        const b = isChoice ? questionStats(q) : blankStats(q, i);
        const total = isChoice ? b.total : b.total;
        const right = isChoice ? b.full : b.right;
        const wrong = Math.max(0, total - right);
        rows.push({
          qno: q.no,
          blank: isChoice ? "选项" : "空" + (i + 1),
          total,
          right,
          wrong,
          rightRate: total ? right / total : 0,
          wrongRate: total ? wrong / total : 0,
          ref: refText(q, isChoice ? 0 : i),
        });
      }
    }
    return rows;
  }

  function ssCell(value, type, style) {
    const attr = style ? ` ss:StyleID="${style}"` : "";
    return `<Cell${attr}><Data ss:Type="${type}">${type === "Number" ? value : xmlEscape(value)}</Data></Cell>`;
  }

  function exportRateTable() {
    const rows = buildRateRows();
    if (!rows.length) throw new Error("没有可导出的题目数据");
    const folder = window.EXAM_DATA.folderName || "考试";
    const scope = taskScopeLabel();
    const when = (window.EXAM_DATA.loadedAt || new Date()).toLocaleString();
    const n = activeStudents().length;
    const xmlRows = [
      `<Row>${ssCell("目录", "String", "meta")}${ssCell(folder, "String")}${ssCell("范围", "String", "meta")}${ssCell(scope, "String")}${ssCell("人数", "String", "meta")}${ssCell(n, "Number")}${ssCell("导出时间", "String", "meta")}${ssCell(when, "String")}</Row>`,
      `<Row></Row>`,
      `<Row>${["题号", "空号", "人数", "正确", "错误", "正确率", "错误率", "参考答案"].map((h) => ssCell(h, "String", "header")).join("")}</Row>`,
    ];
    for (const row of rows) {
      xmlRows.push(`<Row>${
        ssCell(row.qno, "Number")
      }${
        ssCell(row.blank, "String")
      }${
        ssCell(row.total, "Number")
      }${
        ssCell(row.right, "Number")
      }${
        ssCell(row.wrong, "Number")
      }${
        ssCell(row.rightRate, "Number", "pct")
      }${
        ssCell(row.wrongRate, "Number", "pct")
      }${
        ssCell(row.ref, "String")
      }</Row>`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#17362D" ss:Pattern="Solid"/></Style>
  <Style ss:ID="meta"><Font ss:Bold="1" ss:Color="#6D7D74"/></Style>
  <Style ss:ID="q"><Font ss:Bold="1"/><Interior ss:Color="#EEF5EA" ss:Pattern="Solid"/></Style>
  <Style ss:ID="pct"><NumberFormat ss:Format="0.0%"/></Style>
  <Style ss:ID="qpct"><Font ss:Bold="1"/><Interior ss:Color="#EEF5EA" ss:Pattern="Solid"/><NumberFormat ss:Format="0.0%"/></Style>
 </Styles>
 <Worksheet ss:Name="正确率">
  <Table>
   <Column ss:Width="54"/>
   <Column ss:Width="54"/>
   <Column ss:Width="60"/>
   <Column ss:Width="54"/>
   <Column ss:Width="54"/>
   <Column ss:Width="70"/>
   <Column ss:Width="70"/>
   <Column ss:Width="160"/>
   ${xmlRows.join("")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane></WorksheetOptions>
 </Worksheet>
</Workbook>`;
    const blob = new Blob(["\uFEFF" + xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `正确率_${folder}_${scope}_${stamp}.xls`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function isRowMatch(rec) {
    const blanks = rec.blanks || [];
    if (state.blankIndex >= 0) {
      const blank = blanks[state.blankIndex];
      if (!blank) return false;
      if (state.filter === "right") return !!blank.right;
      if (state.filter === "wrong") return !blank.right;
      return true;
    }
    const allRight = blanks.length > 0 && blanks.every((b) => b.right);
    if (state.filter === "right") return allRight;
    if (state.filter === "wrong") return !allRight;
    return true;
  }

  function filteredStudents(question) {
    const q = state.query.trim().toLowerCase();
    return window.EXAM_DATA.students.filter((stu) => {
      if (state.taskFilter !== "all") {
        const tid = stu.taskFolder || stu.taskId || "";
        if (tid !== state.taskFilter) return false;
      }
      const rec = recOf(stu, question);
      if (!rec || !isRowMatch(rec)) return false;
      if (q) {
        const hay = `${stu.stuNo} ${stu.studentId} ${stu.scanId} ${stu.file || ""} ${stu.taskFolder || ""} ${stu.path || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function judge(rec) {
    const blanks = rec.blanks || [];
    if (!blanks.length) return { key: "part", text: "无空" };
    if (state.blankIndex >= 0) {
      const blank = blanks[state.blankIndex];
      if (!blank) return { key: "part", text: "—" };
      return blank.right ? { key: "ok", text: "正确" } : { key: "bad", text: "错误" };
    }
    if (blanks.every((b) => b.right)) return { key: "ok", text: "正确" };
    if (blanks.every((b) => !b.right)) return { key: "bad", text: "错误" };
    return { key: "part", text: "部分" };
  }

  function currentStudent(list) {
    return list.find((s) => s.key === state.studentKey) || list[0] || null;
  }

  function shortTask(id) {
    const text = String(id || "").trim();
    if (!text) return "";
    return text.length <= 6 ? text : text.slice(-6);
  }

  function studentLabel(stu) {
    const task = stu.taskId || stu.taskFolder || "";
    const tip = shortTask(task);
    if (tip) return `${tip} / ${stu.file || ""}`;
    return stu.file || "";
  }

  function studentMetaPayload(stu) {
    if (!stu) return null;
    const payload = {
      task_id: stu.taskIdRaw || stu.taskId || stu.taskFolder || "",
      idx: stu.idx != null ? stu.idx : null,
    };
    return JSON.stringify(payload, null, 2);
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* fallback below */
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function updateCopyMetaBtn(student) {
    const btn = $("copyMetaBtn");
    if (!btn) return;
    if (state.examType === "short") {
      btn.disabled = true;
      return;
    }
    btn.disabled = !student;
    btn.title = student
      ? `复制 task_id 与 idx（${student.stuNo || "当前学生"}）`
      : "请先选中一名学生";
  }

  function syncWorkspaceMode() {
    const short = state.examType === "short";
    const detail = $("detailWorkspace");
    const sw = $("shortWorkspace");
    if (detail) detail.hidden = short;
    if (sw) sw.hidden = !short;
    document.getElementById("app")?.classList.toggle("mode-short", short);
    if (!short) {
      if ($("seriesPick")) $("seriesPick").innerHTML = "";
      if ($("scoreChart")) $("scoreChart").innerHTML = "";
      if ($("compareStats")) $("compareStats").innerHTML = "";
    }
  }

  function filteredSeries() {
    let series = window.EXAM_DATA.series || [];
    if (folderSources.length <= 1 && state.taskFilter !== "all") {
      series = series.filter((s) => s.id === state.taskFilter);
    }
    if (state.compareTasks.size) {
      series = series.filter((s) => state.compareTasks.has(s.id));
    }
    return series;
  }

  function seriesColorById(id) {
    const hit = (window.EXAM_DATA.series || []).find((s) => s.id === id);
    if (hit && hit.colorIndex != null) return seriesColor(hit.colorIndex);
    const idx = (window.EXAM_DATA.series || []).findIndex((s) => s.id === id);
    return seriesColor(idx >= 0 ? idx : 0);
  }

  function scoresForQuestion(students, question) {
    const out = [];
    for (const stu of students) {
      const rec = recOf(stu, question);
      if (!rec) continue;
      out.push(Number(rec.score));
    }
    return out;
  }

  function scoreStep(scores) {
    for (const s of scores) {
      if (Math.abs(s - Math.round(s)) > 0.001) return 0.5;
    }
    return 1;
  }

  function scoreBins(scores, total) {
    const step = scoreStep(scores);
    const max = Math.ceil(total / step) * step;
    const bins = [];
    for (let v = 0; v <= max + 0.001; v += step) {
      bins.push(Math.round(v * 100) / 100);
    }
    const counts = new Map(bins.map((b) => [b, 0]));
    for (const s of scores) {
      const key = Math.round(s / step) * step;
      const k = Math.round(key * 100) / 100;
      if (counts.has(k)) counts.set(k, counts.get(k) + 1);
      else counts.set(k, 1);
    }
    return { step, bins: Array.from(counts.keys()).sort((a, b) => a - b), counts };
  }

  function seriesColor(i) {
    return SERIES_COLORS[i % SERIES_COLORS.length];
  }

  function mean(nums) {
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function median(nums) {
    if (!nums.length) return 0;
    const arr = nums.slice().sort((a, b) => a - b);
    const m = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
  }

  function renderSeriesPick() {
    const root = $("seriesPick");
    if (!root) return;
    const series = window.EXAM_DATA.series || [];
    if (series.length <= 1) {
      root.innerHTML = series.length
        ? `<span class="chart-sub">${escapeHtml(series[0].fullLabel || series[0].label)} · ${series[0].count || series[0].students.length} 份</span>`
        : "";
      return;
    }
    root.innerHTML = series.map((s, i) => {
      const on = state.compareTasks.has(s.id);
      const ci = s.colorIndex != null ? s.colorIndex : i;
      return `<label><input type="checkbox" data-series="${escapeHtml(s.id)}"${on ? " checked" : ""} /><i style="background:${seriesColor(ci)}"></i>${escapeHtml(s.label)}<span class="muted">(${s.count || s.students.length})</span></label>`;
    }).join("");
  }

  function renderScoreChart(question) {
    const host = $("scoreChart");
    if (!host) return;
    const series = filteredSeries();
    if (!series.length) {
      host.innerHTML = `<div class="empty-slice">请选择至少一个对比${folderSources.length > 1 ? "目录" : "任务"}</div>`;
      return;
    }
    const total = question.totalScore || 1;
    const allScores = series.flatMap((s) => scoresForQuestion(s.students, question));
    const { bins } = scoreBins(allScores, total);
    const maxCount = Math.max(1, ...series.flatMap((s) => {
      const { counts } = scoreBins(scoresForQuestion(s.students, question), total);
      return Array.from(counts.values());
    }));
    const barGap = 4;
    const groupW = Math.max(28, Math.min(48, Math.floor(600 / Math.max(bins.length, 1))));
    const barW = Math.max(6, (groupW - barGap * (series.length - 1)) / series.length);
    const width = Math.max(360, bins.length * (groupW + 12) + 48);
    const height = 240;
    const chartH = 180;
    const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="第${question.no}题得分分布">`];
    parts.push(`<line x1="36" y1="${height - 36}" x2="${width - 12}" y2="${height - 36}" stroke="#d7e0d4" />`);
    parts.push(`<line x1="36" y1="24" x2="36" y2="${height - 36}" stroke="#d7e0d4" />`);
    bins.forEach((bin, bi) => {
      const gx = 44 + bi * (groupW + 12);
      series.forEach((s, si) => {
        const { counts } = scoreBins(scoresForQuestion(s.students, question), total);
        const n = counts.get(bin) || 0;
        const bh = (n / maxCount) * chartH;
        const x = gx + si * (barW + barGap);
        const y = height - 36 - bh;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${seriesColorById(s.id)}"><title>${escapeHtml(s.label)} · ${bin}分 · ${n}人</title></rect>`);
      });
      parts.push(`<text x="${(gx + groupW / 2).toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="#6d7d74">${bin}</text>`);
    });
    parts.push(`<text x="12" y="20" font-size="11" fill="#6d7d74">人数</text>`);
    parts.push("</svg>");
    host.innerHTML = parts.join("");
    if ($("chartSub")) {
      const scope = folderSources.length > 1 ? "目录" : "任务";
      $("chartSub").textContent = `第 ${question.no} 题 · 满分 ${total} · ${series.length} 个${scope}对比`;
    }
  }

  function renderCompareStats(question) {
    const root = $("compareStats");
    if (!root) return;
    const series = filteredSeries();
    if (!series.length) {
      root.innerHTML = "";
      return;
    }
    const total = question.totalScore || 0;
    const rows = series.map((s) => {
      const scores = scoresForQuestion(s.students, question);
      const n = scores.length;
      const avg = mean(scores);
      const med = median(scores);
      const full = scores.filter((x) => x >= total - 0.001).length;
      return { s, n, avg, med, full, fullRate: n ? full / n : 0 };
    });
    const baseAvg = rows[0]?.avg || 0;
    root.innerHTML = `<table class="compare-table"><thead><tr>
      <th>任务</th><th>人数</th><th>均分</th><th>中位数</th><th>满分率</th><th>均分差*</th>
    </tr></thead><tbody>${rows.map((r, i) => {
      const gap = r.avg - baseAvg;
      const gapCls = i > 0 && Math.abs(gap) >= 1 ? " gap-warn" : "";
      return `<tr>
        <td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${seriesColorById(r.s.id)};margin-right:6px"></i>${escapeHtml(r.s.fullLabel || r.s.label)}</td>
        <td class="num">${r.n}</td>
        <td class="num">${r.avg.toFixed(2)}</td>
        <td class="num">${r.med.toFixed(2)}</td>
        <td class="num">${fmtPct(r.fullRate)}</td>
        <td class="num${gapCls}">${i === 0 ? "—" : (gap >= 0 ? "+" : "") + gap.toFixed(2)}</td>
      </tr>`;
    }).join("")}</tbody></table><p class="chart-sub">* 均分差相对表格中第一个任务的差值，用于粗看模型偏差</p>`;
  }

  function renderShortMain(question) {
    renderSeriesPick();
    renderScoreChart(question);
    renderCompareStats(question);
  }

  function renderTaskFilter() {
    const sel = $("taskFilter");
    if (!sel) return;
    const tasks = window.EXAM_DATA.tasks || [];
    const opts = [`<option value="all">全部任务${tasks.length ? `（${tasks.length}）` : ""}</option>`];
    for (const t of tasks) {
      opts.push(`<option value="${escapeHtml(t.id)}">${escapeHtml(shortTask(t.id))} · ${t.count} 份</option>`);
    }
    sel.innerHTML = opts.join("");
    sel.value = state.taskFilter;
    sel.disabled = tasks.length <= 1 || folderSources.length > 1;
    if (folderSources.length > 1) {
      sel.title = "多目录对比时请在图表上方勾选目录";
    } else {
      sel.removeAttribute("title");
    }
  }

  function renderNav() {
    $("qCount").textContent = String(window.EXAM_DATA.questions.length);
    $("qNav").innerHTML = window.EXAM_DATA.questions.map((q, i) => {
      const stats = questionStats(q);
      return `<button type="button" class="q-item${i === state.qIndex ? " on" : ""}" data-q="${i}">
        <span class="no">${q.no}</span>
        <span><b>${escapeHtml(q.label || examTypeLabel(state.examType))}</b><small>${state.examType === "short" ? `均分 ${stats.avgScore.toFixed(1)}` : `${stats.full}/${stats.total}`}</small></span>
        <span class="rate">${fmtPct(stats.studentRate)}</span>
      </button>`;
    }).join("");
  }

  function renderHeader(question, stats) {
    $("qBadge").textContent = question.no;
    $("qHeading").textContent = `第 ${question.no} 题`;
    if (state.examType === "short") {
      $("qSub").textContent = `${question.label || "简答题"} · 满分 ${question.totalScore} · ai_mode=2`;
    } else if (state.examType === "choice") {
      const opts = question.optionCount || (question.refAnswers || []).length || 4;
      $("qSub").textContent = `${opts} 项 · ${question.label || "选择题"} · 满分 ${question.totalScore}`;
    } else {
      $("qSub").textContent = `${question.blankCount} 空 · 满分 ${question.totalScore}`;
    }
    if (state.examType === "short") {
      $("statRow").innerHTML = `
        <div class="stat green"><b>${stats.avgScore.toFixed(2)}</b><span>均分</span></div>
        <div class="stat"><b>${fmtPct(stats.studentRate)}</b><span>满分率</span></div>
        <div class="stat"><b>${stats.full}/${stats.total}</b><span>满分人数</span></div>
      `;
      $("shownLabel").textContent = "人";
    } else if (state.examType === "choice") {
      $("statRow").innerHTML = `
        <div class="stat green"><b>${stats.full}/${stats.total}</b><span>答对</span></div>
        <div class="stat"><b>${fmtPct(stats.studentRate)}</b><span>正确率</span></div>
      `;
      $("shownLabel").textContent = "人";
    } else if (state.blankIndex >= 0) {
      const b = blankStats(question, state.blankIndex);
      $("statRow").innerHTML = `
        <div class="stat green"><b>${b.right}/${b.total}</b><span>本空正确</span></div>
        <div class="stat"><b>${fmtPct(b.rate)}</b><span>本空正确率</span></div>
        <div class="stat"><b>${fmtPct(stats.blankRate)}</b><span>全空正确率</span></div>
      `;
      $("shownLabel").textContent = "人";
    } else {
      $("statRow").innerHTML = `
        <div class="stat green"><b>${stats.full}/${stats.total}</b><span>整题正确</span></div>
        <div class="stat"><b>${fmtPct(stats.studentRate)}</b><span>学生正确率</span></div>
        <div class="stat"><b>${fmtPct(stats.blankRate)}</b><span>空题正确率</span></div>
      `;
      $("shownLabel").textContent = "人";
    }
    $("foot").innerHTML = `<span>${window.EXAM_DATA.folderName || "未选择文件夹"}${(window.EXAM_DATA.tasks || []).length > 1 ? " · " + window.EXAM_DATA.tasks.length + " 个任务" : ""} · ${window.EXAM_DATA.students.length} 份 JSON</span><span>mm · ${DPI} DPI${window.EXAM_DATA.loadedAt ? " · " + window.EXAM_DATA.loadedAt.toLocaleTimeString() : ""}</span>`;
  }

  function renderBlankTabs(question) {
    if (state.examType === "choice") {
      state.blankIndex = -1;
      $("blankTabs").innerHTML = `<button type="button" class="blank-tab on" data-blank="-1">整题</button>`;
      const ref = refText(question, 0);
      $("refLine").innerHTML = `
        <span class="ref-label">参考答案</span>
        <div class="ref-body"><strong class="ref-value">${ref ? escapeHtml(ref) : "—"}</strong></div>
      `;
      return;
    }
    const count = question.blankCount || (question.refAnswers || []).length;
    const tabs = [`<button type="button" class="blank-tab${state.blankIndex < 0 ? " on" : ""}" data-blank="-1">整题</button>`];
    for (let i = 0; i < count; i += 1) {
      const b = blankStats(question, i);
      tabs.push(`<button type="button" class="blank-tab${state.blankIndex === i ? " on" : ""}" data-blank="${i}">空${i + 1}<small>${fmtPct(b.rate)}</small></button>`);
    }
    $("blankTabs").innerHTML = tabs.join("");
    const ref = (question.refAnswers || [])[state.blankIndex] || "";
    const refImg = (question.refImages || [])[state.blankIndex] || "";
    if (state.blankIndex >= 0) {
      let body = "";
      if (refImg) {
        body += `<img class="ref-img" src="${escapeHtml(refImg)}" alt="参考答案" />`;
      }
      if (ref) {
        const shown = displayAnswer(ref);
        if (shown && shown !== "空白") body += `<strong class="ref-value">${shown}</strong>`;
      }
      if (!body) body = `<strong class="ref-value">—</strong>`;
      $("refLine").innerHTML = `
        <span class="ref-label">空 ${state.blankIndex + 1} 参考答案</span>
        <div class="ref-body">${body}</div>
      `;
    } else {
      $("refLine").innerHTML = `<span class="ref-label">整题总览</span><div class="ref-body"><strong class="ref-value">点击空号查看该空参考答案与学生作答</strong></div>`;
    }
  }

  function renderSlice(question, student) {
    const board = $("sliceBoard");
    const origin = $("originLink");
    if (!student) {
      board.innerHTML = `<div class="empty-slice">没有符合条件的学生</div>`;
      $("sliceWho").textContent = "未选学生";
      $("sliceNote").textContent = "";
      origin.removeAttribute("href");
      return;
    }
    const rec = recOf(student, question);
    if (!rec || !rec.pos || rec.pos.length < 4) {
      board.innerHTML = `<div class="empty-slice">该生没有本题数据</div>`;
      $("sliceNote").textContent = "";
      return;
    }
    const pos = rec.pos;
    const [x, y, w, h] = pos.map(Number);
    const pageWmm = Number(student.width) || w;
    const pageHmm = Number(student.height) || h;
    const viewPos = expandViewPos(pos, pageWmm, pageHmm, SLICE_VIEW_PAD_MM);
    const [vx, vy, vw, vh] = viewPos;
    const sources = sliceImageUrls(student);
    const pageImg = sources[0] || "";
    const useOss = supportsOssCrop(pageImg);
    const imgUrl = useOss ? ossCrop(pageImg, viewPos) : pageImg;
    const blanks = rec.blanks || [];
    const refLetters = String((blanks[0] && blanks[0].ref) || refText(question, 0) || "");
    let boxes = "";
    if ((rec.options || []).length) {
      boxes = rec.options.map((opt) => {
        if (!opt.pos || opt.pos.length < 4) return "";
        const [bx, by, bw, bh] = opt.pos.map(Number);
        const left = ((bx - vx) / vw) * 100;
        const top = ((by - vy) / vh) * 100;
        const width = (bw / vw) * 100;
        const height = (bh / vh) * 100;
        if (!opt.fill) return "";
        const wrong = blanks[0] && !blanks[0].right;
        const cls = wrong ? " mark wrong" : " mark";
        return `<div class="blank${cls}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></div>`;
      }).join("");
    } else {
      boxes = blanks.map((blank, i) => {
        if (!blank.pos || blank.pos.length < 4) return "";
        const [bx, by, bw, bh] = blank.pos;
        const left = ((bx - vx) / vw) * 100;
        const top = ((by - vy) / vh) * 100;
        const width = (bw / vw) * 100;
        const height = (bh / vh) * 100;
        const on = state.blankIndex === i ? " on" : "";
        const dim = state.blankIndex >= 0 && state.blankIndex !== i ? " dim" : "";
        const cls = blank.right ? "" : " wrong";
        return `<div class="blank${cls}${on}${dim}" data-blank="${i}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;color:${blank.right ? "var(--ok)" : "var(--bad)"}"><span>空${i + 1}</span></div>`;
      }).join("");
    }

    board.style.aspectRatio = `${vw} / ${vh}`;
    board.style.width = `${Math.round(state.zoom * 100)}%`;
    board.style.maxWidth = "640px";
    board.style.height = "auto";
    board.style.maxHeight = "none";
    board.innerHTML = `<img alt="第${question.no}题学生扫描切片" referrerpolicy="no-referrer" src="${imgUrl.replace(/"/g, "&quot;")}" /><div class="overlay">${boxes}</div>`;
    const img = board.querySelector("img");
    if (useOss) {
      clearSliceImgStyles(img);
      img.classList.add("slice-img--fit");
    } else if (pageImg) {
      applyPanCrop(img, student, viewPos);
    } else {
      clearSliceImgStyles(img);
    }

    const noteEl = $("sliceNote");
    const showImgError = () => {
      noteEl.textContent = "扫描图加载失败（链接过期），请点「原图」新窗口查看";
      noteEl.classList.add("warn");
    };

    img.addEventListener("error", () => {
      const step = Number(img.dataset.fallbackStep || "0");
      const next = sources[step + 1];
      if (next && img.src !== next) {
        img.dataset.fallbackStep = String(step + 1);
        img.src = supportsOssCrop(next) ? ossCrop(next, viewPos) : next;
        if (!supportsOssCrop(next)) applyPanCrop(img, student, viewPos);
        else {
          clearSliceImgStyles(img);
          img.classList.add("slice-img--fit");
        }
        return;
      }
      showImgError();
    });
    img.addEventListener("load", () => {
      noteEl.classList.remove("warn");
      if (!noteEl.textContent.startsWith("扫描图加载失败")) {
        noteEl.textContent = `第 ${student.page} 页`;
      }
      if (!useOss && !img.classList.contains("slice-img--pan")) applyPanCrop(img, student, viewPos);
    });

    origin.href = student.origin || student.image || "#";
    $("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
    $("sliceWho").innerHTML = `<b>${escapeHtml(student.stuNo)}</b><span>${escapeHtml(studentLabel(student))}</span>`;
    noteEl.textContent = `第 ${student.page} 页`;
    noteEl.classList.remove("warn");
  }

  function renderTable(question, list, selected) {
    $("shownCount").textContent = String(list.length);
    const table = $("stuTable");
    table.classList.toggle("blank-mode", state.blankIndex >= 0);
    if (state.blankIndex >= 0) {
      $("stuHead").innerHTML = `<tr><th></th><th>作答</th><th>学生</th><th></th></tr>`;
      $("stuBody").innerHTML = list.map((stu) => {
        const rec = recOf(stu, question);
        const blank = rec.blanks[state.blankIndex];
        const j = judge(rec);
        const on = selected && selected.key === stu.key ? " on" : "";
        return `<tr class="${on}" data-stu="${escapeHtml(stu.key)}">
          <td><i class="dot ${j.key}"></i></td>
          <td class="answers ${j.key}">${blank ? displayAnswer(blank.user, blank) : "—"}</td>
          <td class="stu-cell"><b>${escapeHtml(stu.stuNo)}</b><span class="sid">${escapeHtml(studentLabel(stu))}</span></td>
          <td class="judge ${j.key}">${j.text}</td>
        </tr>`;
      }).join("");
      return;
    }
    const optHead = state.examType === "choice" ? "填涂" : "各空";
    $("stuHead").innerHTML = `<tr><th></th><th>学生</th><th>${optHead}</th><th>得分</th><th></th></tr>`;
    $("stuBody").innerHTML = list.map((stu) => {
      const rec = recOf(stu, question);
      const j = judge(rec);
      const on = selected && selected.key === stu.key ? " on" : "";
      let dots = "";
      if ((rec.options || []).length) {
        dots = renderChoiceTrack(rec.options, rec.blanks[0]);
      } else {
        dots = rec.blanks.map((b, i) =>
          `<button type="button" class="mini ${b.right ? "ok" : "bad"}" data-blank="${i}">${i + 1}</button>`
        ).join("");
      }
      return `<tr class="${on}" data-stu="${escapeHtml(stu.key)}">
        <td><i class="dot ${j.key}"></i></td>
        <td class="stu-cell"><b>${escapeHtml(stu.stuNo)}</b><span class="sid">${escapeHtml(studentLabel(stu))}</span></td>
        <td class="${state.examType === "choice" ? "choice-cell" : "mini-row"}">${dots}</td>
        <td class="score-cell"><b>${rec.score}/${rec.total}</b></td>
        <td class="judge ${j.key}">${j.text}</td>
      </tr>`;
    }).join("");
  }

  function renderEmpty() {
    $("qCount").textContent = "0";
    $("qNav").innerHTML = "";
    $("qBadge").textContent = "—";
    $("qHeading").textContent = "第 — 题";
    $("qSub").textContent = `当前题型：${examTypeLabel(state.examType)} · 请选择考试日期目录或单个任务目录`;
    $("statRow").innerHTML = "";
    $("shownCount").textContent = "0";
    $("shownLabel").textContent = "人";
    $("blankTabs").innerHTML = "";
    $("refLine").innerHTML = `<span class="ref-label">参考答案</span><strong class="ref-value">—</strong>`;
    if ($("taskFilter")) {
      $("taskFilter").innerHTML = `<option value="all">全部任务</option>`;
      $("taskFilter").disabled = true;
      $("taskFilter").value = "all";
    }
    state.taskFilter = "all";
    $("sliceBoard").innerHTML = `<div class="empty-slice">请选择文件夹后查看扫描切片</div>`;
    $("sliceWho").textContent = "未选学生";
    $("sliceNote").textContent = "";
    if ($("exportBtn")) $("exportBtn").disabled = true;
    updateCompareFolderBtn(false);
    if ($("reloadBtn")) $("reloadBtn").disabled = true;
    renderFolderSourceChips();
    updateCopyMetaBtn(null);
    $("stuHead").innerHTML = "";
    $("stuBody").innerHTML = "";
    $("foot").innerHTML = `<span>${examTypeLabel(state.examType)} · 数据来自所选文件夹中的 JSON</span><span></span>`;
    syncExamTypeSwitch();
    syncWorkspaceMode();
    if ($("scoreChart")) $("scoreChart").innerHTML = "";
    if ($("compareStats")) $("compareStats").innerHTML = "";
  }

  function updateCompareFolderBtn(hasStudents) {
    const btn = $("addCompareFolderBtn");
    if (!btn) return;
    btn.disabled = !hasStudents || state.examType !== "short";
    btn.hidden = state.examType !== "short";
  }

  function syncExamTypeSwitch() {
    const root = $("examTypeSwitch");
    if (!root) return;
    for (const btn of root.querySelectorAll("[data-type]")) {
      btn.classList.toggle("on", btn.dataset.type === state.examType);
    }
    updateCompareFolderBtn((window.EXAM_DATA.students || []).length > 0);
  }

  function render() {
    syncWorkspaceMode();
    const question = (window.EXAM_DATA.questions || [])[state.qIndex];
    if (!question) {
      renderEmpty();
      return;
    }
    const stats = questionStats(question);
    renderNav();
    renderHeader(question, stats);
    if (state.examType === "short") {
      renderShortMain(question);
      updateCopyMetaBtn(null);
      return;
    }
    const maxBlank = (question.blankCount || 1) - 1;
    if (state.blankIndex > maxBlank) state.blankIndex = 0;
    const list = filteredStudents(question);
    if (!list.some((s) => s.key === state.studentKey)) {
      state.studentKey = list[0] ? list[0].key : "";
    }
    const student = currentStudent(list);
    renderBlankTabs(question);
    renderSlice(question, student);
    renderTable(question, list, student);
    updateCopyMetaBtn(student);
  }

  function bind() {
    $("examTypeSwitch").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-type]");
      if (!btn || btn.dataset.type === state.examType) return;
      state.examType = btn.dataset.type;
      state.qIndex = 0;
      state.studentKey = "";
      state.blankIndex = 0;
      state.filter = "all";
      state.query = "";
      if ($("stuSearch")) $("stuSearch").value = "";
      for (const el of $("statusFilter").querySelectorAll("button")) {
        el.classList.toggle("on", el.dataset.filter === "all");
      }
      syncExamTypeSwitch();
      folderSources.length = 0;
      if (folderSources.length) {
        await refreshLive();
      } else {
        renderEmpty();
      }
    });
    $("qNav").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-q]");
      if (!btn) return;
      state.qIndex = Number(btn.dataset.q);
      state.blankIndex = 0;
      render();
    });
    $("blankTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-blank]");
      if (!btn) return;
      state.blankIndex = Number(btn.dataset.blank);
      render();
    });
    $("sliceBoard").addEventListener("click", (e) => {
      const box = e.target.closest("[data-blank]");
      if (!box) return;
      state.blankIndex = Number(box.dataset.blank);
      render();
    });
    $("statusFilter").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      for (const el of $("statusFilter").querySelectorAll("button")) {
        el.classList.toggle("on", el === btn);
      }
      render();
    });
    $("stuSearch").addEventListener("input", (e) => {
      state.query = e.target.value;
      render();
    });
    $("taskFilter").addEventListener("change", (e) => {
      state.taskFilter = e.target.value || "all";
      render();
    });
    $("seriesPick").addEventListener("change", (e) => {
      const cb = e.target.closest("[data-series]");
      if (!cb) return;
      if (cb.checked) state.compareTasks.add(cb.dataset.series);
      else state.compareTasks.delete(cb.dataset.series);
      render();
    });
    $("stuBody").addEventListener("click", (e) => {
      const blankBtn = e.target.closest("[data-blank]");
      const row = e.target.closest("[data-stu]");
      if (blankBtn) {
        state.blankIndex = Number(blankBtn.dataset.blank);
        if (row) state.studentKey = row.dataset.stu;
        render();
        return;
      }
      if (!row) return;
      state.studentKey = row.dataset.stu;
      render();
    });
    $("zoomIn").addEventListener("click", () => {
      state.zoom = Math.min(3, Math.round((state.zoom + 0.25) * 100) / 100);
      render();
    });
    $("zoomOut").addEventListener("click", () => {
      state.zoom = Math.max(0.5, Math.round((state.zoom - 0.25) * 100) / 100);
      render();
    });
    $("zoomReset").addEventListener("click", () => {
      state.zoom = SLICE_ZOOM_DEFAULT;
      render();
    });
    $("pickJsonBtn").addEventListener("click", async () => {
      try {
        await pickJsonBundle({ append: false });
        render();
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
    });
    $("pickFolderBtn").addEventListener("click", async () => {
      try {
        await pickFolder({ append: false });
        render();
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
    });
    $("addCompareFolderBtn").addEventListener("click", async () => {
      try {
        await pickCompareFolder();
        render();
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
    });
    $("folderSourceChips").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-source]");
      if (!btn) return;
      removeFolderSource(btn.dataset.removeSource);
    });
    $("folderInput").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const append = state.folderPickAppend;
      if (!append) folderSources.length = 0;
      const name = files[0].webkitRelativePath
        ? files[0].webkitRelativePath.split(/[\\/]/)[0]
        : "已选文件夹";
      folderSources.push({
        id: newFolderSourceId(),
        name,
        handle: null,
        files,
        bundleFile: null,
      });
      state.folderPickAppend = false;
      try {
        await loadAllFolderSources();
        render();
      } catch (err) {
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
      e.target.value = "";
    });
    $("jsonFileInput").addEventListener("change", async (e) => {
      const file = (e.target.files || [])[0];
      if (!file) return;
      const append = state.jsonPickAppend;
      if (!append) folderSources.length = 0;
      folderSources.push({
        id: newFolderSourceId(),
        name: file.name,
        handle: null,
        files: [],
        bundleFile: file,
      });
      state.jsonPickAppend = false;
      try {
        await loadAllFolderSources();
        render();
      } catch (err) {
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
      e.target.value = "";
    });
    $("reloadBtn").addEventListener("click", () => {
      refreshLive();
    });
    $("exportBtn").addEventListener("click", () => {
      try {
        exportRateTable();
      } catch (err) {
        console.error(err);
        $("folderMeta").textContent = "导出失败：" + (err.message || err);
      }
    });
    $("copyMetaBtn").addEventListener("click", async () => {
      const question = (window.EXAM_DATA.questions || [])[state.qIndex];
      if (!question) return;
      const list = filteredStudents(question);
      const student = currentStudent(list);
      const text = studentMetaPayload(student);
      if (!text) return;
      const btn = $("copyMetaBtn");
      const ok = await copyText(text);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = ok ? "已复制" : "复制失败";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1500);
      }
      if (!ok) $("folderMeta").textContent = "复制失败，请检查浏览器权限";
    });
  }

  let loading = false;
  async function refreshLive() {
    if (loading) return;
    if (!folderSources.length) {
      renderEmpty();
      return;
    }
    loading = true;
    const btn = $("reloadBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "读取中";
    }
    try {
      await loadFolderData();
      render();
    } catch (err) {
      console.error(err);
      $("folderMeta").textContent = "读取 JSON 失败：" + (err.message || err);
    } finally {
      loading = false;
      if (btn) {
        btn.disabled = !folderSources.length;
        btn.textContent = "重新读取";
      }
      if ($("exportBtn")) $("exportBtn").disabled = !(window.EXAM_DATA.students || []).length;
      updateCompareFolderBtn((window.EXAM_DATA.students || []).length > 0);
    }
  }

  bind();
  syncExamTypeSwitch();
  syncWorkspaceMode();
  renderEmpty();
})();
