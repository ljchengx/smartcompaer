(function () {
  const DPI = 200;
  const MM_PER_INCH = 25.4;
  window.EXAM_DATA = window.EXAM_DATA || { examId: "", taskId: "", dpi: DPI, questions: [], students: [] };

  const state = {
    qIndex: 0,
    studentKey: "",
    filter: "all",
    taskFilter: "all",
    query: "",
    blankIndex: 0,
    zoom: 1,
  };

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

  function extractQs(rec) {
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
      }
      const pos = inflatePos(unionPos(posBoxes) || [0, 0, pageW, pageH], 2, pageW, pageH);
      qs[qno] = { score: Math.round(score * 100) / 100, total: Math.round(total * 100) / 100, pos, blanks };
    }
    return qs;
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

  function studentFromRec(rec, relPath) {
    const path = String(relPath || "").replace(/\\/g, "/");
    const file = path.split("/").pop() || path;
    const fromJson = rec.pre_task_id || String(rec.task_id || "").split("_")[0] || "";
    const taskId = fromJson || taskFolderFromPath(path, "");
    const taskFolder = taskFolderFromPath(path, taskId) || taskId;
    const key = `${taskId || taskFolder || "task"}::${file}::${rec.stu_no || rec.student_id || rec.stuScanId || ""}`;
    return {
      key,
      stuNo: rec.stu_no || "",
      studentId: rec.student_id || "",
      scanId: rec.stuScanId || rec._id || "",
      page: rec.page || 1,
      width: Number(rec.width || 0),
      height: Number(rec.height || 0),
      image: rec.image || "",
      origin: rec.origin || "",
      file,
      path,
      taskId,
      taskFolder,
      qs: extractQs(rec),
      examId: rec.exam_id || "",
    };
  }

  function buildQuestions(students) {
    const meta = {};
    for (const stu of students) {
      for (const [qno, rec] of Object.entries(stu.qs || {})) {
        if (!meta[qno]) {
          meta[qno] = {
            no: Number(qno),
            id: "",
            type: 3,
            aiMode: 1,
            label: "填空题",
            blankCount: 0,
            totalScore: 0,
            refAnswers: [],
            refImages: [],
            pos: rec.pos,
          };
        }
        const blanks = rec.blanks || [];
        meta[qno].blankCount = Math.max(meta[qno].blankCount, blanks.length);
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

  const folderSource = {
    name: "",
    handle: null,
    files: [],
  };

  function isStudentRec(rec) {
    return rec && typeof rec === "object" && (Array.isArray(rec.ai_questions) || rec.stu_no != null);
  }

  function sortStudents(recs) {
    return recs.slice().sort((a, b) => {
      const ta = String(a.taskFolder || a.taskId || "");
      const tb = String(b.taskFolder || b.taskId || "");
      if (ta !== tb) return ta.localeCompare(tb, "en", { numeric: true });
      return String(a.file || "").localeCompare(String(b.file || ""), "en", { numeric: true });
    });
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

  function applyStudents(recs, folderName) {
    const students = sortStudents(recs);
    const tasks = taskListOf(students);
    if (state.taskFilter !== "all" && !tasks.some((t) => t.id === state.taskFilter)) {
      state.taskFilter = "all";
    }
    window.EXAM_DATA = {
      examId: students[0] ? students[0].examId : "",
      taskId: students[0] ? students[0].taskId : "",
      dpi: DPI,
      questions: buildQuestions(students),
      students,
      tasks,
      loadedAt: new Date(),
      folderName: folderName || "",
    };
    const taskText = tasks.length > 1 ? ` · ${tasks.length} 个任务` : tasks.length === 1 ? ` · 任务 ${tasks[0].id.slice(0, 8)}…` : "";
    $("folderMeta").textContent = students.length
      ? `${folderName}${taskText} · ${students.length} 份 JSON`
      : `${folderName || "已选文件夹"} · 没有可解析的学生 JSON`;
    $("reloadBtn").disabled = !folderSource.handle && !folderSource.files.length;
    if ($("exportBtn")) $("exportBtn").disabled = !students.length;
    if (state.qIndex >= window.EXAM_DATA.questions.length) state.qIndex = 0;
    renderTaskFilter();
  }

  function parseJsonFile(file, relPath) {
    return file.text().then((text) => {
      const rec = JSON.parse(text);
      if (!isStudentRec(rec)) return null;
      return studentFromRec(rec, relPath);
    }).catch(() => null);
  }

  async function collectJsonHandles(dirHandle, prefix) {
    const items = [];
    for await (const [name, handle] of dirHandle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        if (name.startsWith(".") || name === "assets" || name === "node_modules") continue;
        items.push(...await collectJsonHandles(handle, path));
      } else if (/\.json$/i.test(name) && !/^(package(-lock)?|tsconfig|exam)\.json$/i.test(name)) {
        items.push({ name, path, handle });
      }
    }
    return items;
  }

  async function loadFromDirectoryHandle(dirHandle) {
    const perm = await dirHandle.queryPermission({ mode: "read" });
    if (perm !== "granted") {
      const next = await dirHandle.requestPermission({ mode: "read" });
      if (next !== "granted") throw new Error("没有读取该文件夹的权限");
    }
    const items = await collectJsonHandles(dirHandle, "");
    items.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
    const recs = (await Promise.all(items.map(async (item) => {
      const file = await item.handle.getFile();
      return parseJsonFile(file, item.path);
    }))).filter(Boolean);
    if (!recs.length) throw new Error("文件夹里没有可解析的学生 JSON");
    applyStudents(recs, dirHandle.name);
  }

  async function loadFromFileList(fileList) {
    const files = Array.from(fileList || []).filter((file) => {
      const name = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      const base = name.split("/").pop();
      return /\.json$/i.test(base) && !/^(package(-lock)?|tsconfig|exam)\.json$/i.test(base);
    });
    files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "en", { numeric: true }));
    const recs = (await Promise.all(files.map((file) => {
      const rel = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      const parts = rel.split("/");
      const path = parts.length > 1 ? parts.slice(1).join("/") : rel;
      return parseJsonFile(file, path);
    }))).filter(Boolean);
    const folderName = files[0] && files[0].webkitRelativePath
      ? files[0].webkitRelativePath.split(/[\\/]/)[0]
      : (folderSource.name || "已选文件夹");
    if (!recs.length) throw new Error("文件夹里没有可解析的学生 JSON");
    applyStudents(recs, folderName);
  }

  async function loadFolderData() {
    if (folderSource.handle) {
      await loadFromDirectoryHandle(folderSource.handle);
      return;
    }
    if (folderSource.files.length) {
      await loadFromFileList(folderSource.files);
      return;
    }
    throw new Error("请先选择文件夹");
  }

  async function pickFolder() {
    if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      folderSource.handle = handle;
      folderSource.files = [];
      folderSource.name = handle.name;
      await loadFromDirectoryHandle(handle);
      return;
    }
    $("folderInput").click();
  }

  function ossCrop(url, pos) {
    if (!url || !pos || pos.length < 4) return url || "";
    const [x, y, w, h] = pos.map(mmToPx);
    const clean = url.split("?")[0];
    return `${clean}?x-oss-process=image/crop,x_${x},y_${y},w_${Math.max(1, w)},h_${Math.max(1, h)}`;
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
    for (const stu of students) {
      const rec = recOf(stu, question);
      if (!rec) continue;
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
    for (const q of questions) {
      const count = q.blankCount || 0;
      for (let i = 0; i < count; i += 1) {
        const b = blankStats(q, i);
        const wrong = Math.max(0, b.total - b.right);
        rows.push({
          qno: q.no,
          blank: "空" + (i + 1),
          total: b.total,
          right: b.right,
          wrong,
          rightRate: b.rate,
          wrongRate: b.total ? wrong / b.total : 0,
          ref: refText(q, i),
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
    sel.disabled = tasks.length <= 1;
  }

  function renderNav() {
    $("qCount").textContent = String(window.EXAM_DATA.questions.length);
    $("qNav").innerHTML = window.EXAM_DATA.questions.map((q, i) => {
      const stats = questionStats(q);
      return `<button type="button" class="q-item${i === state.qIndex ? " on" : ""}" data-q="${i}">
        <span class="no">${q.no}</span>
        <span><b>填空题</b><small>${stats.full}/${stats.total}</small></span>
        <span class="rate">${fmtPct(stats.studentRate)}</span>
      </button>`;
    }).join("");
  }

  function renderHeader(question, stats) {
    $("qBadge").textContent = question.no;
    $("qHeading").textContent = `第 ${question.no} 题`;
    $("qSub").textContent = `${question.blankCount} 空 · 满分 ${question.totalScore}`;
    if (state.blankIndex >= 0) {
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
    const pos = rec.pos;
    const [x, y, w, h] = pos;
    const imgUrl = ossCrop(student.image, pos);
    const blanks = rec.blanks || [];
    const boxes = blanks.map((blank, i) => {
      if (!blank.pos || blank.pos.length < 4) return "";
      const [bx, by, bw, bh] = blank.pos;
      const left = ((bx - x) / w) * 100;
      const top = ((by - y) / h) * 100;
      const width = (bw / w) * 100;
      const height = (bh / h) * 100;
      const on = state.blankIndex === i ? " on" : "";
      const dim = state.blankIndex >= 0 && state.blankIndex !== i ? " dim" : "";
      const cls = blank.right ? "" : " wrong";
      return `<div class="blank${cls}${on}${dim}" data-blank="${i}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;color:${blank.right ? "var(--ok)" : "var(--bad)"}"><span>空${i + 1}</span></div>`;
    }).join("");

    board.style.aspectRatio = `${w} / ${h}`;
    board.style.width = `${Math.round(state.zoom * 100)}%`;
    board.style.maxWidth = "640px";
    board.style.height = "auto";
    board.style.maxHeight = "none";
    board.innerHTML = `<img alt="第${question.no}题学生扫描切片" src="${imgUrl}" /><div class="overlay">${boxes}</div>`;
    const img = board.querySelector("img");
    img.addEventListener("error", () => {
      if (img.dataset.fallback === "1") return;
      img.dataset.fallback = "1";
      img.src = student.image;
      img.style.width = `${(student.width / w) * 100}%`;
      img.style.maxWidth = "none";
      img.style.position = "absolute";
      img.style.left = `${(-x / w) * 100}%`;
      img.style.top = `${(-y / h) * 100}%`;
    });

    origin.href = student.origin || student.image;
    $("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
    $("sliceWho").innerHTML = `<b>${escapeHtml(student.stuNo)}</b><span>${escapeHtml(studentLabel(student))}</span>`;
    $("sliceNote").textContent = `第 ${student.page} 页`;
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
    $("stuHead").innerHTML = `<tr><th></th><th>学生</th><th>各空</th><th>得分</th><th></th></tr>`;
    $("stuBody").innerHTML = list.map((stu) => {
      const rec = recOf(stu, question);
      const j = judge(rec);
      const on = selected && selected.key === stu.key ? " on" : "";
      const dots = rec.blanks.map((b, i) =>
        `<button type="button" class="mini ${b.right ? "ok" : "bad"}" data-blank="${i}">${i + 1}</button>`
      ).join("");
      return `<tr class="${on}" data-stu="${escapeHtml(stu.key)}">
        <td><i class="dot ${j.key}"></i></td>
        <td class="stu-cell"><b>${escapeHtml(stu.stuNo)}</b><span class="sid">${escapeHtml(studentLabel(stu))}</span></td>
        <td class="mini-row">${dots}</td>
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
    $("qSub").textContent = "请选择考试日期目录或单个任务目录";
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
    $("stuHead").innerHTML = "";
    $("stuBody").innerHTML = "";
    $("foot").innerHTML = `<span>数据来自所选文件夹中的 JSON</span><span></span>`;
  }

  function render() {
    const question = (window.EXAM_DATA.questions || [])[state.qIndex];
    if (!question) {
      renderEmpty();
      return;
    }
    const maxBlank = (question.blankCount || 1) - 1;
    if (state.blankIndex > maxBlank) state.blankIndex = 0;
    const stats = questionStats(question);
    const list = filteredStudents(question);
    if (!list.some((s) => s.key === state.studentKey)) {
      state.studentKey = list[0] ? list[0].key : "";
    }
    const student = currentStudent(list);
    renderNav();
    renderHeader(question, stats);
    renderBlankTabs(question);
    renderSlice(question, student);
    renderTable(question, list, student);
  }

  function bind() {
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
      state.zoom = 1;
      render();
    });
    $("pickFolderBtn").addEventListener("click", async () => {
      try {
        await pickFolder();
        render();
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
    });
    $("folderInput").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      folderSource.handle = null;
      folderSource.files = files;
      folderSource.name = files[0].webkitRelativePath
        ? files[0].webkitRelativePath.split(/[\\/]/)[0]
        : "已选文件夹";
      try {
        await loadFromFileList(files);
        render();
      } catch (err) {
        console.error(err);
        $("folderMeta").textContent = "读取失败：" + (err.message || err);
      }
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
  }

  let loading = false;
  async function refreshLive() {
    if (loading) return;
    if (!folderSource.handle && !folderSource.files.length) {
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
        btn.disabled = !folderSource.handle && !folderSource.files.length;
        btn.textContent = "重新读取";
      }
      if ($("exportBtn")) $("exportBtn").disabled = !(window.EXAM_DATA.students || []).length;
    }
  }

  bind();
  renderEmpty();
})();
