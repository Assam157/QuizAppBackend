 require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { createObjectCsvWriter } = require("csv-writer");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

// --------------- MIDDLEWARE ---------------
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-key'],
  credentials: true,
}));
app.use(express.json());

// --------------- FILE UPLOAD ---------------
const upload = multer({ dest: "uploads/" });
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ensure results folder exists
const resultsDir = path.join(__dirname, "results");
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// --------------- MONGOOSE ---------------
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ============ MODELS ============
const questionSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  options: {
    A: { type: String, required: true },
    B: { type: String, required: true },
    C: { type: String, required: true },
    D: { type: String, required: true },
  },
  correctAnswer: { type: String, enum: ["A", "B", "C", "D"], required: true },
  imageUrl: { type: String, default: "" },
  published: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Question = mongoose.model("Question", questionSchema);

const studentSchema = new mongoose.Schema({
  regNo: { type: String, unique: true, required: true },
  quizName: { type: String, default: "" },
  customData: { type: Map, of: String, default: () => new Map() },
  registeredAt: { type: Date, default: Date.now },
});
const Student = mongoose.model("Student", studentSchema);

const quizAttemptSchema = new mongoose.Schema({
  studentRegNo: { type: String, ref: "Student", required: true },
  quizName: { type: String, default: "" },
  startTime: Date,
  endTime: Date,
  answers: [String],
  score: { type: Number, default: null },
  totalMarksObtained: { type: Number, default: null },
  totalMarks: { type: Number, default: null },
  totalTimeMinutes: { type: Number, default: null },
  durationMinutes: { type: Number, default: 25 },
  positiveMarks: { type: Number, default: 1 },
  negativeMarks: { type: Number, default: 1 },
  disqualified: { type: Boolean, default: false },
  submitted: { type: Boolean, default: false },
  rank: { type: Number, default: null },
});
const QuizAttempt = mongoose.model("QuizAttempt", quizAttemptSchema);

const archivedAttemptSchema = new mongoose.Schema({
  studentRegNo: String,
  quizName: String,
  startTime: Date,
  endTime: Date,
  answers: [String],
  score: Number,
  totalMarksObtained: Number,
  totalMarks: Number,
  totalTimeMinutes: Number,
  durationMinutes: Number,
  positiveMarks: Number,
  negativeMarks: Number,
  disqualified: Boolean,
  submitted: Boolean,
  rank: Number,
  archivedAt: { type: Date, default: Date.now },
});
const ArchivedQuizAttempt = mongoose.model("ArchivedQuizAttempt", archivedAttemptSchema);

const examConfigSchema = new mongoose.Schema({
  quizName: { type: String, default: "National Science and Technology Digital Archive (NSTAD) Online Quiz" },
  startTime: { type: Date, required: true },
  durationMinutes: { type: Number, required: true, default: 25 },
  positiveMarks: { type: Number, default: 1 },
  negativeMarks: { type: Number, default: 1 },
  registrationFields: {
    type: Map,
    of: new mongoose.Schema({
      enabled: { type: Boolean, default: true },
      required: { type: Boolean, default: false },
    }),
    default: () => new Map(),
  },
  ranksFinalised: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
  quizVersion: { type: Number, default: 1 },
});
const ExamConfig = mongoose.model("ExamConfig", examConfigSchema);

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", counterSchema);

// ============ HELPERS ============

async function getExamConfig() {
  let config = await ExamConfig.findOne();
  if (!config) {
    config = new ExamConfig({
      quizName: "National Science and Technology Digital Archive (NSTAD) Online Quiz",
      startTime: process.env.QUIZ_START_TIME
        ? new Date(process.env.QUIZ_START_TIME)
        : new Date(Date.now() + 5 * 60000),
      durationMinutes: 25,
      positiveMarks: 1,
      negativeMarks: 1,
    });
    await config.save();
    console.log("📝 Default exam config created (NSTAD rules)");
  }
  return config;
}

async function generateRegNo() {
  const config = await getExamConfig();
  const version = config.quizVersion || 1;
  const counterId = `regNo_${version}`;

  const counter = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `TRV-${String(counter.seq).padStart(4, '0')}-${version}`;
}

// ---------- CSV helpers ----------
function getCsvPath(quizName) {
  const sanitized = quizName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return path.join(resultsDir, `results_${sanitized}.csv`);
}

function deleteCsvByQuizName(quizName) {
  const csvPath = getCsvPath(quizName);
  if (fs.existsSync(csvPath)) {
    fs.unlinkSync(csvPath);
    console.log(`🗑️ Deleted results CSV: ${csvPath}`);
    return true;
  }
  console.log(`ℹ️ Results CSV not found: ${csvPath}`);
  return false;
}

function getCustomDataObject(customData) {
  if (!customData) return {};
  if (customData instanceof Map) return Object.fromEntries(customData);
  if (typeof customData === 'object') return customData;
  return {};
}

function getCustomDataMap(customData) {
  if (!customData) return new Map();
  if (customData instanceof Map) return customData;
  if (typeof customData === 'object') {
    return new Map(Object.entries(customData));
  }
  return new Map();
}

async function rebuildCsv(quizName) {
  const attempts = await QuizAttempt.find({
    submitted: true,
    quizName: quizName,
  }).sort({ rank: 1 }).lean();

  const regNos = attempts.map(a => a.studentRegNo);
  const students = await Student.find({ regNo: { $in: regNos } }).lean();
  const studentMap = {};
  students.forEach(s => {
    studentMap[s.regNo] = getCustomDataObject(s.customData);
  });

  const allQuestions = await Question.find({ published: true }).sort({ createdAt: 1 }).lean();

  const records = attempts.map((a) => {
    const custom = studentMap[a.studentRegNo] || {};
    const name = custom.name || "";
    const email = custom.email || "";
    const correct = a.score || 0;
    let wrong = 0;
    if (a.answers) {
      a.answers.forEach((ans, idx) => {
        if (idx < allQuestions.length && ans !== null && ans !== allQuestions[idx].correctAnswer) {
          wrong++;
        }
      });
    }
    return {
      regNo: a.studentRegNo,
      name,
      email,
      correctCount: correct,
      wrongCount: wrong,
      totalMarksObtained: a.totalMarksObtained,
      totalMarks: a.totalMarks,
      totalTimeMinutes: a.totalTimeMinutes,
      rank: a.rank,
      timeOfSubmission: a.endTime?.toISOString() || "",
      disqualified: a.disqualified ? "YES" : "NO",
    };
  });

  const csvPath = getCsvPath(quizName);
  const writer = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: "regNo", title: "RegNo" },
      { id: "name", title: "Name" },
      { id: "email", title: "Email" },
      { id: "correctCount", title: "Correct" },
      { id: "wrongCount", title: "Wrong" },
      { id: "totalMarksObtained", title: "MarksObtained" },
      { id: "totalMarks", title: "TotalMarks" },
      { id: "totalTimeMinutes", title: "TimeMinutes" },
      { id: "rank", title: "Rank" },
      { id: "timeOfSubmission", title: "SubmissionTime" },
      { id: "disqualified", title: "Disqualified" },
    ],
    append: false,
  });
  await writer.writeRecords(records);
  console.log(`✅ Results CSV rebuilt for quiz "${quizName}" -> ${csvPath}`);
}

function getRegistrationCsvPath(quizName) {
  const sanitized = quizName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return path.join(resultsDir, `registrations_${sanitized}.csv`);
}

async function rebuildRegistrationCsv(quizName) {
  const students = await Student.find({ quizName: quizName }).sort({ registeredAt: 1 }).lean();
  const csvPath = getRegistrationCsvPath(quizName);

  if (students.length === 0) {
    const header = [
      { id: "regNo", title: "RegNo" },
      { id: "registeredAt", title: "Registration Time" },
    ];
    const writer = createObjectCsvWriter({
      path: csvPath,
      header,
      append: false,
    });
    await writer.writeRecords([]);
    console.log(`📄 Registration CSV created (empty) for "${quizName}"`);
    return;
  }

  const allCustomKeys = new Set();
  students.forEach(s => {
    const data = getCustomDataMap(s.customData);
    data.forEach((_, key) => allCustomKeys.add(key));
  });
  allCustomKeys.add('name');
  allCustomKeys.add('email');
  const sortedKeys = Array.from(allCustomKeys).sort();

  const header = [
    { id: "regNo", title: "RegNo" },
    { id: "registeredAt", title: "Registration Time" },
  ];
  sortedKeys.forEach(key => {
    header.push({ id: key, title: key.charAt(0).toUpperCase() + key.slice(1) });
  });

  const records = students.map(s => {
    const data = getCustomDataMap(s.customData);
    const record = {
      regNo: s.regNo,
      registeredAt: s.registeredAt.toISOString(),
    };
    sortedKeys.forEach(key => {
      record[key] = data.get(key) || "";
    });
    return record;
  });

  const writer = createObjectCsvWriter({
    path: csvPath,
    header,
    append: false,
  });
  await writer.writeRecords(records);
  console.log(`📄 Registration CSV rebuilt for "${quizName}" -> ${csvPath}`);
}

async function finalizeRanks() {
  try {
    console.log("⏳ Finalising ranks...");
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";

    const attempts = await QuizAttempt.find({ submitted: true, quizName }).lean();
    const nonDisqualified = attempts
      .filter(a => !a.disqualified)
      .sort((a, b) => {
        if (b.totalMarksObtained !== a.totalMarksObtained) return b.totalMarksObtained - a.totalMarksObtained;
        return a.totalTimeMinutes - b.totalTimeMinutes;
      });

    let rank = 1;
    for (let i = 0; i < nonDisqualified.length; i++) {
      const a = nonDisqualified[i];
      if (i > 0) {
        const prev = nonDisqualified[i - 1];
        if (a.totalMarksObtained === prev.totalMarksObtained && a.totalTimeMinutes === prev.totalTimeMinutes) {
          await QuizAttempt.updateOne({ _id: a._id }, { $set: { rank: prev.rank } });
          continue;
        }
      }
      await QuizAttempt.updateOne({ _id: a._id }, { $set: { rank: rank } });
      rank++;
    }
    await QuizAttempt.updateMany({ submitted: true, disqualified: true, quizName }, { $set: { rank: -1 } });

    await rebuildCsv(quizName);
    await ExamConfig.updateOne({}, { $set: { ranksFinalised: true } });
    console.log(`✅ Ranks finalised. ${nonDisqualified.length} participants ranked.`);
  } catch (err) {
    console.error("Finalisation error:", err);
  }
}

// ---------- Watcher ----------
let watcherInterval = null;
function startRankWatcher() {
  if (watcherInterval) clearInterval(watcherInterval);
  watcherInterval = setInterval(async () => {
    try {
      const config = await getExamConfig();
      const now = Date.now();
      const startTime = config.startTime.getTime();
      const endTime = startTime + config.durationMinutes * 60000;
      if (now < startTime && config.ranksFinalised) {
        await ExamConfig.updateOne({}, { $set: { ranksFinalised: false } });
        return;
      }
      if (config.ranksFinalised) {
        clearInterval(watcherInterval);
        watcherInterval = null;
        return;
      }
      if (now > endTime) {
        await finalizeRanks();
      }
    } catch (err) {
      console.error("Watcher error:", err);
    }
  }, 30000);
}

// ============ NEW: Generate Questions CSV string ============
async function getQuestionsCsvString() {
  const questions = await Question.find().sort({ createdAt: 1 }).lean();
  if (questions.length === 0) return '';
  const records = questions.map(q => ({
    question: q.question,
    optionA: q.options.A,
    optionB: q.options.B,
    optionC: q.options.C,
    optionD: q.options.D,
    correctAnswer: q.correctAnswer,
    imageUrl: q.imageUrl || '',
    published: q.published ? 'Yes' : 'No',
    createdAt: q.createdAt ? q.createdAt.toISOString() : '',
  }));
  const header = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Image URL', 'Published', 'Created At'];
  const rows = records.map(r => [
    r.question,
    r.optionA,
    r.optionB,
    r.optionC,
    r.optionD,
    r.correctAnswer,
    r.imageUrl,
    r.published,
    r.createdAt
  ]);
  const csvLines = [header.join(',')];
  rows.forEach(row => {
    const escaped = row.map(field => {
      if (typeof field === 'string' && (field.includes(',') || field.includes('"') || field.includes('\n'))) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    });
    csvLines.push(escaped.join(','));
  });
  return csvLines.join('\n');
}

// ============ ROUTES ============

// ---------- Admin config ----------
app.get("/admin/config", async (req, res) => {
  try {
    const config = await getExamConfig();
    const regFields = config.registrationFields
      ? Object.fromEntries(config.registrationFields)
      : {};
    res.json({
      success: true,
      config: {
        ...config.toObject(),
        registrationFields: regFields,
        quizName: config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz",
        quizVersion: config.quizVersion || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not fetch config" });
  }
});

app.post("/admin/config", async (req, res) => {
  try {
    const { startTime, durationMinutes, positiveMarks, negativeMarks, registrationFields, quizName } = req.body;
    if (!startTime || durationMinutes == null || positiveMarks == null || negativeMarks == null)
      return res.status(400).json({ success: false, message: "Missing required fields" });

    await Question.deleteMany({});
    console.log("🧹 All questions deleted due to config update.");

    let config = await ExamConfig.findOne();
    if (!config) config = new ExamConfig();
    const newQuizName = quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";
    config.quizName = newQuizName;
    config.startTime = new Date(startTime);
    config.durationMinutes = parseInt(durationMinutes);
    config.positiveMarks = parseFloat(positiveMarks);
    config.negativeMarks = parseFloat(negativeMarks);
    config.ranksFinalised = false;

    const map = new Map();
    if (registrationFields) {
      for (const [key, value] of Object.entries(registrationFields)) {
        if (key === 'name' || key === 'email') continue;
        map.set(key, {
          enabled: value.enabled ?? true,
          required: value.required ?? false,
        });
      }
    }
    config.registrationFields = map;

    config.updatedAt = new Date();
    await config.save();

    await rebuildCsv(newQuizName);
    await rebuildRegistrationCsv(newQuizName);

    startRankWatcher();
    res.json({ success: true, config });
  } catch (err) {
    console.error("Config update error:", err);
    res.status(500).json({ success: false, message: "Update failed" });
  }
});

// ---------- Registration config (public) ----------
app.get("/registration-config", async (req, res) => {
  try {
    const config = await getExamConfig();
    const fields = config.registrationFields
      ? Object.fromEntries(config.registrationFields)
      : {};
    res.json({ success: true, registrationFields: fields });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not fetch config" });
  }
});

// ---------- Register student (hardcoded name & email) ----------
 app.post("/register", async (req, res) => {
  try {
    const config = await getExamConfig();
    const extraFields = config.registrationFields ? Object.fromEntries(config.registrationFields) : {};
    const customData = new Map();

    const name = req.body.name;
    const email = req.body.email;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: "Name and email are required." });
    }
    customData.set('name', name);
    customData.set('email', email);

    const missing = [];
    for (const [fieldName, settings] of Object.entries(extraFields)) {
      if (!settings.enabled) continue;
      const value = req.body[fieldName];
      if (settings.required && !value) missing.push(fieldName);
      if (value !== undefined) customData.set(fieldName, value);
    }
    if (missing.length)
      return res.status(400).json({ success: false, message: `Required: ${missing.join(", ")}` });

    const existing = await Student.findOne({ "customData.email": email });
    if (existing) return res.status(409).json({ success: false, message: "Email already registered" });

    const regNo = await generateRegNo();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";

    const student = new Student({ regNo, quizName, customData });
    await student.save();

    await rebuildRegistrationCsv(quizName);

    // ========== PDF GENERATION (buffered, no width option in rules) ==========
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=reg-${regNo}.pdf`);
      res.send(pdfData);
    });
    doc.on('error', (err) => {
      console.error("PDF generation error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "PDF generation failed" });
      }
    });

    // ---- Background ----
    const bgPath = path.join(__dirname, "assets", "image.png");
    if (fs.existsSync(bgPath)) {
      doc.image(bgPath, 0, 0, { width: doc.page.width, height: doc.page.height });
    } else {
      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#f8f9fa");
    }

    const pageWidth = doc.page.width;
    console.log("📐 pageWidth =", pageWidth); // Debug: ensure it's a number
    const centerX = pageWidth / 2;

    // ---- Header ----
    doc.fontSize(28)
       .fillColor("#1a237e")
       .font("Helvetica-Bold")
       .text(config.quizName, centerX, 80, { align: "center" })
       .moveDown(0.5);

    doc.fontSize(18)
       .fillColor("#303f9f")
       .font("Helvetica")
       .text("Registration Confirmation", centerX, 130, { align: "center" })
       .moveDown(1);

    // ---- Student details card ----
    const cardX = 80;
    const cardY = 180;
    const cardWidth = pageWidth - 160;
    const cardHeight = 260;

    doc.fillColor("#ffffff")
       .fillOpacity(0.85)
       .rect(cardX, cardY, cardWidth, cardHeight)
       .fill()
       .fillOpacity(1)
       .strokeColor("#b0bec5")
       .lineWidth(1)
       .rect(cardX, cardY, cardWidth, cardHeight)
       .stroke();

    let yPos = cardY + 30;
    const leftCol = cardX + 30;
    const rightCol = cardX + 200;

    const detailFontSize = 13;
    const labelColor = "#455a64";
    const valueColor = "#1e293b";

    doc.fontSize(detailFontSize).font("Helvetica-Bold").fillColor(labelColor);
    doc.text("Registration No:", leftCol, yPos);
    doc.font("Helvetica").fillColor(valueColor);
    doc.text(regNo, rightCol, yPos);
    yPos += 30;

    doc.font("Helvetica-Bold").fillColor(labelColor);
    doc.text("Name:", leftCol, yPos);
    doc.font("Helvetica").fillColor(valueColor);
    doc.text(name, rightCol, yPos);
    yPos += 30;

    doc.font("Helvetica-Bold").fillColor(labelColor);
    doc.text("Email:", leftCol, yPos);
    doc.font("Helvetica").fillColor(valueColor);
    doc.text(email, rightCol, yPos);
    yPos += 30;

    for (const [fieldName, settings] of Object.entries(extraFields)) {
      if (!settings.enabled) continue;
      const value = customData.get(fieldName) || "";
      if (value) {
        const label = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
        doc.font("Helvetica-Bold").fillColor(labelColor);
        doc.text(label + ":", leftCol, yPos);
        doc.font("Helvetica").fillColor(valueColor);
        doc.text(value, rightCol, yPos);
        yPos += 30;
      }
    }

    const startStr = config.startTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    doc.font("Helvetica-Bold").fillColor(labelColor);
    doc.text("Quiz Date & Time (IST):", leftCol, yPos);
    doc.font("Helvetica").fillColor(valueColor);
    doc.text(startStr, rightCol, yPos);

    // ---- Rules & Regulations (no width option) ----
    const rulesY = cardY + cardHeight + 40;
    doc.fontSize(16)
       .fillColor("#1a237e")
       .font("Helvetica-Bold")
       .text("Rules & Regulations", centerX, rulesY, { align: "center" })
       .moveDown(0.5);

    const ruleFontSize = 11;
    const ruleColor = "#37474f";
    const bulletX = 70;

    const rules = [
      "The National Science and Technology Digital Archive (NSTAD) invites students from standard XI to undergraduate any stream to participate in this online quiz celebrating the life, work, and scientific legacy of Acharya Prafulla Chandra Ray, one of India's greatest chemists and pioneers of modern scientific research.",
      "",
      "Eligibility:",
      "✔ The quiz is open to students of Class XI, Class XII, and Undergraduates from any recognized school, college, or university.",
      "✔ Participation is free of cost.",
      "✔ Each participant is permitted to submit only one entry. Multiple submissions by the same participant may lead to disqualification.",
      "",
      "Quiz Format:",
      "The quiz consists of multiple-choice questions (MCQs) based on the archival documents related to Acharya Prafulla Chandra Ray.",
      "Participants are encouraged to explore the collections of scientists pages available on www.nstad.in before attempting the quiz.",
      "",
      "Submission Guidelines:",
      `The quiz will be available on ${startStr} and will close at ${new Date(config.startTime.getTime() + config.durationMinutes * 60000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
      "Responses submitted after the closing time will not be considered.",
      "Once submitted, responses cannot be edited or resubmitted.",
      "",
      "Time:",
      `Total 25 multiple choice questions will appear one by one. Duration is ${config.durationMinutes} minutes; the quiz will automatically close at the scheduled time.`,
      "",
      "Evaluation:",
      "⮚ Each correct answer carries One mark.",
      "⮚ There is negative marking. One mark will be deducted for 1 wrong answer.",
      "⮚ In the event of a tie, participants who submitted their entries earlier will be given preference. If required, the organizing committee may apply additional tie-breaking criteria.",
      "",
      "Fair Participation:",
      "Participants should answer the questions independently.",
      "The use of unfair means or submission of multiple entries by the same participant may lead to disqualification.",
      "The organizers reserve the right to verify participant details before announcing the results.",
      "",
      "Results:",
      "Winners will be selected based on the highest scores in accordance with the quiz rules. In case of equal marks, response time will be considered. The fastest response will be declared the winner.",
      "The decision of the organizing committee shall be final and binding in all matters related to the quiz.",
      "",
      "Disclaimer:",
      "By participating, entrants agree to abide by these Rules & Regulations.",
      "Organisers will not be responsible for poor internet connectivity at user end. No extension of time will be allowed for any cause whatsoever.",
      "The organizers reserve the right to modify, postpone, or cancel the quiz under unforeseen circumstances without prior notice.",
      "",
      "Explore the National Science and Technology Digital Archive and discover the remarkable scientific contributions of Acharya Prafulla Chandra Ray before taking the quiz. Visit: www.nstad.in"
    ];

    // ---- Loop with NO 'width' option ----
    rules.forEach((rule) => {
      if (rule.trim() === "") {
        doc.moveDown(0.5);
        return;
      }

      let prefix = "• ";
      let text = rule;
      let isHeading = false;

      if (rule.startsWith("✔")) {
        prefix = "✔ ";
        text = rule.substring(1).trim();
      } else if (rule.startsWith("⮚")) {
        prefix = "⮚ ";
        text = rule.substring(1).trim();
      } else if (rule.startsWith("•")) {
        prefix = "• ";
        text = rule.substring(1).trim();
      } else if (/^[A-Za-z\s]+:/.test(rule)) {
        isHeading = true;
        text = rule;
      }

      if (isHeading) {
        doc.font("Helvetica-Bold")
           .fillColor("#1a237e")
           .fontSize(ruleFontSize + 1);
      } else {
        doc.font("Helvetica")
           .fillColor(ruleColor)
           .fontSize(ruleFontSize);
      }

      const content = isHeading ? text : prefix + text;
      // Draw WITHOUT width – uses default margins (so text wraps properly)
      doc.text(content, bulletX, { align: 'left' });
      // Small gap after each line
      doc.moveDown(0.2);
    });

    // ---- Footer ----
    const footerY = doc.page.height - 40;
    doc.fontSize(10)
       .fillColor("#78909c")
       .text("Generated by NSTAD Online Quiz System", centerX, footerY, { align: "center" });

    doc.end();

  } catch (err) {
    console.error("Registration error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  }
});
// ---------- Get questions ----------
app.get("/get-questions", async (req, res) => {
  try {
    const config = await getExamConfig();
    const now = new Date();
    if (now < config.startTime) return res.status(403).json({ success: false, message: "Quiz not started" });
    const questions = await Question.find({ published: true }).sort({ createdAt: 1 });
    res.json({ success: true, questions, positiveMarks: config.positiveMarks, negativeMarks: config.negativeMarks });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Start quiz ----------
app.post("/start-quiz", async (req, res) => {
  try {
    const { regNo } = req.body;
    const config = await getExamConfig();
    const now = new Date();
    const quizEnd = new Date(config.startTime.getTime() + config.durationMinutes * 60000);
    if (now < config.startTime || now > quizEnd)
      return res.status(403).json({ success: false, message: "Quiz is not active" });

    let attempt = await QuizAttempt.findOne({ studentRegNo: regNo, submitted: false });
    if (!attempt) {
      const student = await Student.findOne({ regNo });
      if (!student) return res.status(404).json({ success: false, message: "Student not found" });
      attempt = new QuizAttempt({
        studentRegNo: regNo,
        quizName: config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz",
        startTime: now,
        durationMinutes: config.durationMinutes,
        positiveMarks: config.positiveMarks,
        negativeMarks: config.negativeMarks,
        answers: [],
        submitted: false,
      });
      await attempt.save();
    }
    res.json({ success: true, startTime: attempt.startTime, durationMinutes: attempt.durationMinutes });
  } catch (err) {
    console.error("Start quiz error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Submit quiz ----------
app.post("/submit-quiz", async (req, res) => {
  try {
    const { regNo, answers } = req.body;
    if (!regNo || !answers) return res.status(400).json({ success: false, message: "Missing data" });

    const now = new Date();
    const config = await getExamConfig();
    const attempt = await QuizAttempt.findOne({ studentRegNo: regNo, submitted: false });
    if (!attempt) return res.status(404).json({ success: false, message: "No active quiz session" });

    const studentEnd = new Date(attempt.startTime.getTime() + attempt.durationMinutes * 60000);
    if (now > studentEnd) {
      attempt.disqualified = true;
      attempt.score = -1;
      attempt.totalMarksObtained = -1;
      attempt.totalTimeMinutes = Math.round(((now - attempt.startTime) / 60000) * 100) / 100;
      attempt.submitted = true;
      attempt.endTime = now;
      attempt.answers = answers;
      await attempt.save();
      await rebuildCsv(config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz");
      return res.json({ success: true, disqualified: true, message: "Time expired. You are disqualified." });
    }

    const questions = await Question.find({ published: true }).sort({ createdAt: 1 });
    const totalQ = questions.length;
    while (answers.length < totalQ) answers.push(null);

    let correct = 0, wrong = 0;
    answers.forEach((ans, idx) => {
      if (idx < questions.length) {
        if (ans === questions[idx].correctAnswer) correct++;
        else if (ans !== null) wrong++;
      }
    });

    const posMarks = attempt.positiveMarks;
    const negMarks = attempt.negativeMarks;
    const maxMarks = totalQ * posMarks;
    let netMarks = correct * posMarks - wrong * negMarks;
    netMarks = Math.round(netMarks * 100) / 100;

    const totalTimeMinutes = Math.round(((now - attempt.startTime) / 60000) * 100) / 100;

    attempt.endTime = now;
    attempt.totalTimeMinutes = totalTimeMinutes;
    attempt.answers = answers;
    attempt.score = correct;
    attempt.totalMarksObtained = netMarks;
    attempt.totalMarks = maxMarks;
    attempt.submitted = true;
    await attempt.save();

    await rebuildCsv(config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz");

    res.json({
      success: true,
      score: correct,
      correctCount: correct,
      wrongCount: wrong,
      totalMarksObtained: netMarks,
      totalMarks: maxMarks,
      totalQuestions: totalQ,
      totalTimeMinutes,
      disqualified: false,
    });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ success: false, message: "Submission failed" });
  }
});

// ---------- Finalise ranks (manual) ----------
app.post("/finalize-ranks", async (req, res) => {
  try {
    await finalizeRanks();
    res.json({ success: true, message: "Ranks finalised manually." });
  } catch (err) {
    console.error("Finalise ranks error:", err);
    res.status(500).json({ success: false, message: "Rank finalisation failed" });
  }
});
// ---------- Backup ZIP (without resetting) ----------
app.get("/admin/backup-zip", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";

    // Read existing CSVs (if they exist)
    const resultsPath = getCsvPath(quizName);
    const registrationsPath = getRegistrationCsvPath(quizName);
    let resultsCsv = fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, 'utf8') : '';
    let registrationsCsv = fs.existsSync(registrationsPath) ? fs.readFileSync(registrationsPath, 'utf8') : '';
    const questionsCsv = await getQuestionsCsvString();

    const archive = archiver('zip', { zlib: { level: 9 } });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = quizName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const zipName = `backup_${safeName}_${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    archive.pipe(res);

    archive.append(resultsCsv, { name: 'results.csv' });
    archive.append(registrationsCsv, { name: 'registrations.csv' });
    archive.append(questionsCsv, { name: 'questions.csv' });

    await archive.finalize();
  } catch (err) {
    console.error("Backup error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

// ---------- Archive & Clear ----------
app.post("/admin/archive-and-clear", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";

    const attempts = await QuizAttempt.find({ submitted: true, quizName }).lean();
    if (attempts.length === 0) {
      return res.status(400).json({ success: false, message: "No attempts to archive." });
    }

    const archivedDocs = attempts.map(a => ({
      ...a,
      archivedAt: new Date(),
    }));
    await ArchivedQuizAttempt.insertMany(archivedDocs);
    await QuizAttempt.deleteMany({ quizName });
    console.log(`🗄️ Archived ${attempts.length} attempts for "${quizName}" and cleared.`);

    await ExamConfig.updateOne({}, { $set: { ranksFinalised: false } });

    await rebuildCsv(quizName);
    await rebuildRegistrationCsv(quizName);

    res.json({
      success: true,
      message: `Archived ${attempts.length} attempts for "${quizName}", cleared QuizAttempt, and reset CSVs.`,
    });
  } catch (err) {
    console.error("Archive error:", err);
    res.status(500).json({ success: false, message: "Archive failed." });
  }
});

// ---------- Reset exam (with versioning and auto‑download ZIP) ----------
app.post("/admin/reset-exam", async (req, res) => {
  try {
    // 1. Get current config (or create default)
    let config = await ExamConfig.findOne();
    if (!config) {
      config = new ExamConfig({
        quizName: "National Science and Technology Digital Archive (NSTAD) Online Quiz",
        startTime: new Date(Date.now() + 5 * 60000),
        durationMinutes: 25,
        positiveMarks: 1,
        negativeMarks: 1,
        registrationFields: new Map(),
        quizVersion: 1,
      });
      await config.save();
    }

    const oldQuizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";
    console.log(`🔄 Resetting exam for quiz: "${oldQuizName}"`);

    // ---- Gather current CSV data before any deletion ----
    let resultsCsv = '';
    const resultsPath = getCsvPath(oldQuizName);
    if (fs.existsSync(resultsPath)) {
      resultsCsv = fs.readFileSync(resultsPath, 'utf8');
    }

    let registrationsCsv = '';
    const registrationsPath = getRegistrationCsvPath(oldQuizName);
    if (fs.existsSync(registrationsPath)) {
      registrationsCsv = fs.readFileSync(registrationsPath, 'utf8');
    }

    const questionsCsv = await getQuestionsCsvString();

    // ---- Perform reset operations ----
    await Student.deleteMany({ quizName: oldQuizName });
    await QuizAttempt.deleteMany({ quizName: oldQuizName });
    console.log(`🗑️ Deleted students and attempts for "${oldQuizName}".`);

    const newVersion = (config.quizVersion || 1) + 1;
    config.quizVersion = newVersion;
    console.log(`📌 New quiz version: ${newVersion}`);

    await Counter.findOneAndUpdate(
      { _id: `regNo_${newVersion}` },
      { $set: { seq: 0 } },
      { upsert: true }
    );
    console.log(`📊 Counter for version ${newVersion} reset to 0.`);

    const now = new Date();
    const newStart = new Date(now.getTime() + 5 * 60000);
    config.startTime = newStart;
    config.ranksFinalised = false;
    config.durationMinutes = 25;
    config.positiveMarks = 1;
    config.negativeMarks = 1;

    if (req.body?.quizName) {
      config.quizName = req.body.quizName;
    }
    await config.save();

    // Rebuild CSVs (empty)
    await rebuildCsv(config.quizName);
    await rebuildRegistrationCsv(config.quizName);

    // Restart watcher
    startRankWatcher();

    // ---- Send ZIP archive with the three CSV files ----
    const archive = archiver('zip', { zlib: { level: 9 } });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = oldQuizName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const zipName = `backup_${safeName}_${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    archive.pipe(res);

    // Append the CSV data
    archive.append(resultsCsv, { name: 'results.csv' });
    archive.append(registrationsCsv, { name: 'registrations.csv' });
    archive.append(questionsCsv, { name: 'questions.csv' });

    await archive.finalize();

  } catch (err) {
    console.error("❌ Reset exam error:", err);
    // If we haven't sent headers yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    } else {
      // If headers already sent, we can only close the connection
      res.end();
    }
  }
});

// ---------- Publish all questions ----------
app.post("/admin/publish-questions", async (req, res) => {
  try {
    const config = await getExamConfig();
    const now = new Date();
    if (now >= config.startTime) {
      return res.status(403).json({
        success: false,
        message: "Quiz has already started. You cannot publish questions now."
      });
    }

    const count = await Question.countDocuments();
    if (count === 0) {
      return res.status(400).json({
        success: false,
        message: "No questions to publish. Add at least one question first."
      });
    }

    const result = await Question.updateMany({}, { $set: { published: true } });

    res.json({
      success: true,
      message: `✅ Successfully published ${result.modifiedCount} questions.`,
      count: result.modifiedCount,
    });
  } catch (err) {
    console.error("Publish error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Disqualified CSV ----------
app.get("/admin/disqualified-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";

    const disqualifiedAttempts = await QuizAttempt.find({
      quizName,
      disqualified: true,
      submitted: true,
    }).lean();

    if (disqualifiedAttempts.length === 0) {
      return res.status(404).json({ success: false, message: "No disqualified students." });
    }

    const regNos = disqualifiedAttempts.map(a => a.studentRegNo);
    const students = await Student.find({ regNo: { $in: regNos } }).lean();
    const studentMap = {};
    students.forEach(s => {
      studentMap[s.regNo] = getCustomDataObject(s.customData);
    });

    const records = disqualifiedAttempts.map(a => {
      const custom = studentMap[a.studentRegNo] || {};
      return {
        regNo: a.studentRegNo,
        name: custom.name || "",
        email: custom.email || "",
        submittedAt: a.endTime ? a.endTime.toISOString() : "",
        totalTimeMinutes: a.totalTimeMinutes || 0,
      };
    });

    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const fileName = `disqualified_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    const csvPath = path.join(resultsDir, fileName);

    const writer = createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: "regNo", title: "Registration No." },
        { id: "name", title: "Name" },
        { id: "email", title: "Email" },
        { id: "submittedAt", title: "Submission Time" },
        { id: "totalTimeMinutes", title: "Time Taken (mins)" },
      ],
      append: false,
    });

    await writer.writeRecords(records);

    const downloadName = `disqualified_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    res.download(csvPath, downloadName);
  } catch (err) {
    console.error("Disqualified CSV error:", err);
    res.status(500).json({ success: false, message: "Server error: " + err.message });
  }
});

// ---------- List CSV files ----------
app.get("/admin/list-csvs", async (req, res) => {
  try {
    const files = fs.readdirSync(resultsDir);
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Force watcher reload ----------
app.post("/admin/reload-watcher", async (req, res) => {
  try {
    startRankWatcher();
    const config = await getExamConfig();
    res.json({
      success: true,
      message: "Watcher reloaded",
      startTime: config.startTime,
      endTime: new Date(config.startTime.getTime() + config.durationMinutes * 60000),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Get rank ----------
app.get("/my-rank", async (req, res) => {
  try {
    const { regNo } = req.query;
    if (!regNo) return res.status(400).json({ success: false, message: "Missing regNo" });

    const attempt = await QuizAttempt.findOne({ studentRegNo: regNo, submitted: true });
    if (!attempt) return res.status(404).json({ success: false, message: "No submission found" });

    res.json({ success: true, rank: attempt.rank, disqualified: attempt.disqualified });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Debug attempt ----------
app.get("/debug-attempt/:regNo", async (req, res) => {
  try {
    const attempt = await QuizAttempt.findOne({ studentRegNo: req.params.regNo });
    if (!attempt) return res.status(404).json({ success: false, message: "No attempt found" });
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Finalize overdue attempts ----------
app.post("/finalize-quiz", async (req, res) => {
  try {
    const now = new Date();
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";
    const overdue = await QuizAttempt.find({ submitted: false, startTime: { $exists: true }, quizName });
    for (let a of overdue) {
      const end = new Date(a.startTime.getTime() + a.durationMinutes * 60000);
      if (now > end) {
        a.disqualified = true;
        a.score = -1;
        a.totalMarksObtained = -1;
        a.totalTimeMinutes = Math.round(((end - a.startTime) / 60000) * 100) / 100;
        a.submitted = true;
        a.endTime = end;
        await a.save();
      }
    }
    await rebuildCsv(quizName);
    res.json({ success: true, message: "Overdue attempts finalized" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Finalization failed" });
  }
});

// ---------- Download results CSV ----------
app.get("/results-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";
    const filePath = getCsvPath(quizName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "No results yet for this quiz" });
    }
    const downloadName = `results_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    res.download(filePath, downloadName);
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Download registration CSV ----------
app.get("/registrations-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";
    const filePath = getRegistrationCsvPath(quizName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "No registrations yet for this quiz" });
    }
    const downloadName = `registrations_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    res.download(filePath, downloadName);
  } catch (err) {
    console.error("Download registration CSV error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- List available result files ----------
app.get("/available-results", async (req, res) => {
  try {
    const files = fs.readdirSync(resultsDir);
    const csvFiles = files.filter(f => f.startsWith("results_") && f.endsWith(".csv"));
    res.json({ success: true, files: csvFiles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Clear CSV manually ----------
app.delete("/admin/clear-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "National Science and Technology Digital Archive (NSTAD) Online Quiz";
    deleteCsvByQuizName(quizName);
    const regCsv = getRegistrationCsvPath(quizName);
    if (fs.existsSync(regCsv)) fs.unlinkSync(regCsv);
    await rebuildCsv(quizName);
    await rebuildRegistrationCsv(quizName);
    res.json({ success: true, message: `Current quiz CSVs cleared for "${quizName}"` });
  } catch (err) {
    console.error("Clear CSV error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Debug endpoints ----------
app.get("/servertime", async (req, res) => {
  const config = await getExamConfig();
  const now = new Date();
  const quizEnd = new Date(config.startTime.getTime() + config.durationMinutes * 60000);
  res.json({
    serverTimeUTC: now.toISOString(),
    serverTimeIST: now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    QUIZ_START_IST: config.startTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    QUIZ_END_UTC: quizEnd.toISOString(),
    isQuizOpen: now >= config.startTime && now <= quizEnd,
    durationMinutes: config.durationMinutes,
    positiveMarks: config.positiveMarks,
    negativeMarks: config.negativeMarks,
    ranksFinalised: config.ranksFinalised,
  });
});

app.get("/quiz-status", async (req, res) => {
  try {
    const config = await getExamConfig();
    const now = new Date();
    const quizEnd = new Date(config.startTime.getTime() + config.durationMinutes * 60000);
    const isOpen = now >= config.startTime && now <= quizEnd;
    const hasEnded = now > quizEnd;
    res.json({
      isQuizOpen: isOpen,
      hasEnded: hasEnded,
      startTime: config.startTime,
      endTime: quizEnd,
      durationMinutes: config.durationMinutes,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============ CRUD ROUTES FOR QUESTIONS (no auth) ============
app.get("/questions", async (req, res) => {
  try {
    const questions = await Question.find().sort({ createdAt: -1 });
    res.json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/post-question", upload.single("image"), async (req, res) => {
  try {
    let { question, options, correctAnswer } = req.body;
    if (typeof options === "string") {
      try { options = JSON.parse(options); } catch (e) {
        return res.status(400).json({ success: false, message: "Invalid options format" });
      }
    }
    if (!question || !options?.A || !options?.B || !options?.C || !options?.D || !correctAnswer) {
      return res.status(400).json({ success: false, message: "Incomplete MCQ data" });
    }
    let imageUrl = "";
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }
    const newQuestion = new Question({ question, options, correctAnswer, imageUrl, published: false });
    await newQuestion.save();
    res.status(201).json({ success: true, message: "MCQ saved as draft" });
  } catch (err) {
    console.error("Post question error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.put("/update-question/:id", upload.single("image"), async (req, res) => {
  try {
    let { question, options, correctAnswer, imageUrl } = req.body;
    if (typeof options === "string") {
      try { options = JSON.parse(options); } catch (e) {
        return res.status(400).json({ success: false, message: "Invalid options format" });
      }
    }
    const updateData = { question, options, correctAnswer };
    if (req.file) {
      updateData.imageUrl = `/uploads/${req.file.filename}`;
    } else if (imageUrl !== undefined) {
      updateData.imageUrl = imageUrl;
    }
    const updated = await Question.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ success: true, question: updated });
  } catch (err) {
    console.error("Update question error:", err);
    res.status(500).json({ success: false, message: "Update failed" });
  }
});

app.delete("/delete-question/:id", async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Question deleted" });
  } catch (err) {
    console.error("Delete question error:", err);
    res.status(500).json({ success: false, message: "Delete failed" });
  }
});

// --------------- START SERVER ---------------
startRankWatcher();
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  getExamConfig().then((c) =>
    console.log(`⏰ Quiz: ${c.startTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`)
  );
});
