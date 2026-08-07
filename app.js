require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { createObjectCsvWriter } = require("csv-writer");

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
  quizName: { type: String, default: "" },
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
  durationMinutes: { type: Number, default: 30 },
  positiveMarks: { type: Number, default: 1 },
  negativeMarks: { type: Number, default: 0 },
  disqualified: { type: Boolean, default: false },
  submitted: { type: Boolean, default: false },
  rank: { type: Number, default: null },
});
const QuizAttempt = mongoose.model("QuizAttempt", quizAttemptSchema);

const archivedAttemptSchema = new mongoose.Schema({
  studentRegNo: String,
  studentName: { type: String, default: "" },
  studentEmail: { type: String, default: "" },
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
  quizName: { type: String, default: "Trivia Quiz" },
  startTime: { type: Date, required: true },
  durationMinutes: { type: Number, required: true, default: 30 },
  positiveMarks: { type: Number, default: 1 },
  negativeMarks: { type: Number, default: 0 },
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
  archived: { type: Boolean, default: false }, // NEW: flag to avoid re-archiving
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
      quizName: "Trivia Quiz",
      startTime: process.env.QUIZ_START_TIME
        ? new Date(process.env.QUIZ_START_TIME)
        : new Date(Date.now() + 5 * 60000),
      durationMinutes: 30,
      positiveMarks: 1,
      negativeMarks: 0,
    });
    await config.save();
    console.log("📝 Default exam config created");
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
  try {
    console.log(`🔄 Rebuilding CSV for quiz: "${quizName}"`);
    const attempts = await QuizAttempt.find({
      submitted: true,
      quizName: quizName,
    }).sort({ rank: 1 }).lean();

    if (attempts.length === 0) {
      // Create empty CSV
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
      await writer.writeRecords([]);
      console.log(`📄 Results CSV created (empty) for "${quizName}"`);
      return;
    }

    const regNos = attempts.map(a => a.studentRegNo);
    const students = await Student.find({ regNo: { $in: regNos } }).lean();
    const studentMap = {};
    students.forEach(s => {
      studentMap[s.regNo] = getCustomDataObject(s.customData);
    });

    const allQuestions = await Question.find({ published: true, quizName }).sort({ createdAt: 1 }).lean();

    const records = attempts.map((a) => {
      const custom = studentMap[a.studentRegNo] || {};
      const name = custom.name || "";
      const email = custom.email || "";
      const correct = a.score || 0;
      let wrong = 0;
      if (a.answers && allQuestions.length > 0) {
        a.answers.forEach((ans, idx) => {
          if (idx < allQuestions.length && ans !== null && ans !== "" && ans !== allQuestions[idx].correctAnswer) {
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
        totalMarksObtained: a.totalMarksObtained || 0,
        totalMarks: a.totalMarks || 0,
        totalTimeMinutes: a.totalTimeMinutes || 0,
        rank: a.disqualified ? -1 : (a.rank || null),
        timeOfSubmission: a.endTime?.toISOString() || "",
        disqualified: a.disqualified ? "YES" : "NO",
      };
    });

    // Sort by rank (non‑disqualified first)
    records.sort((a, b) => {
      if (a.disqualified === "YES" && b.disqualified === "NO") return 1;
      if (a.disqualified === "NO" && b.disqualified === "YES") return -1;
      if (a.rank === null && b.rank !== null) return 1;
      if (a.rank !== null && b.rank === null) return -1;
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      return 0;
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
  } catch (error) {
    console.error("❌ Error rebuilding CSV:", error);
    throw error;
  }
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

// ==================== NEW FUNCTIONS ====================

async function disqualifyOverdueAttempts(quizName, quizEndTime) {
  const overdue = await QuizAttempt.find({
    quizName,
    submitted: false,
    startTime: { $exists: true, $ne: null },
  });

  let count = 0;
  for (let a of overdue) {
    const personalEnd = new Date(a.startTime.getTime() + a.durationMinutes * 60000);
    if (personalEnd <= quizEndTime) {
      a.disqualified = true;
      a.score = -1;
      a.totalMarksObtained = -1;
      a.totalTimeMinutes = Math.round(((quizEndTime - a.startTime) / 60000) * 100) / 100;
      a.submitted = true;
      a.endTime = quizEndTime;
      a.rank = -1;
      await a.save();
      count++;
    }
  }
  if (count > 0) console.log(`🚫 Disqualified ${count} overdue unsubmitted attempts.`);
  return count;
}

async function autoArchiveQuiz(quizName) {
  const attempts = await QuizAttempt.find({ submitted: true, quizName }).lean();
  if (attempts.length === 0) return 0;

  const regNos = attempts.map(a => a.studentRegNo);
  const students = await Student.find({ regNo: { $in: regNos } }).lean();
  const studentMap = {};
  students.forEach(s => {
    const custom = getCustomDataObject(s.customData);
    studentMap[s.regNo] = { name: custom.name || "", email: custom.email || "" };
  });

  const archivedDocs = attempts.map(a => ({
    ...a,
    studentName: studentMap[a.studentRegNo]?.name || "",
    studentEmail: studentMap[a.studentRegNo]?.email || "",
    archivedAt: new Date(),
  }));

  await ArchivedQuizAttempt.insertMany(archivedDocs);
  await QuizAttempt.deleteMany({ quizName });
  console.log(`🗄️ Auto‑archived ${archivedDocs.length} attempts for "${quizName}"`);

  // Rebuild registration CSV (students remain) and results CSV (will be empty)
  await rebuildRegistrationCsv(quizName);
  await rebuildCsv(quizName);
  return archivedDocs.length;
}

async function finalizeRanks() {
  try {
    console.log("⏳ Finalising ranks and cleaning up...");
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";

    // 1. Disqualify overdue unsubmitted attempts
    const quizEnd = new Date(config.startTime.getTime() + config.durationMinutes * 60000);
    await disqualifyOverdueAttempts(quizName, quizEnd);

    // 2. Re‑fetch all submitted attempts for ranking
    const attempts = await QuizAttempt.find({
      submitted: true,
      quizName,
      disqualified: false,
    }).lean();

    if (attempts.length > 0) {
      const sorted = attempts
        .filter(a => a.totalMarksObtained !== null && a.totalMarksObtained !== undefined)
        .sort((a, b) => {
          if (b.totalMarksObtained !== a.totalMarksObtained)
            return b.totalMarksObtained - a.totalMarksObtained;
          return a.totalTimeMinutes - b.totalTimeMinutes;
        });

      let currentRank = 1;
      for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];
        if (i > 0) {
          const prev = sorted[i - 1];
          if (current.totalMarksObtained === prev.totalMarksObtained &&
              current.totalTimeMinutes === prev.totalTimeMinutes) {
            await QuizAttempt.updateOne({ _id: current._id }, { $set: { rank: prev.rank } });
            continue;
          }
        }
        await QuizAttempt.updateOne({ _id: current._id }, { $set: { rank: currentRank } });
        currentRank++;
      }
    }

    // Set rank -1 for disqualified submitted attempts
    await QuizAttempt.updateMany(
      { submitted: true, disqualified: true, quizName },
      { $set: { rank: -1 } }
    );

    await rebuildCsv(quizName);
    await ExamConfig.updateOne({}, { $set: { ranksFinalised: true } });
    console.log(`✅ Ranks finalised.`);

    // 3. Auto‑archive if not already archived
    const configAfter = await ExamConfig.findOne();
    if (!configAfter.archived) {
      const archivedCount = await autoArchiveQuiz(quizName);
      if (archivedCount > 0) {
        await ExamConfig.updateOne({}, { $set: { archived: true } });
        console.log(`📦 Quiz "${quizName}" auto‑archived with ${archivedCount} attempts.`);
      } else {
        // No attempts to archive, but mark as archived anyway to avoid repeated checks
        await ExamConfig.updateOne({}, { $set: { archived: true } });
      }
    }

  } catch (err) {
    console.error("❌ Finalisation error:", err);
  }
}

let watcherInterval = null;
function startRankWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }

  watcherInterval = setInterval(async () => {
    try {
      const config = await getExamConfig();
      const now = Date.now();
      const startTime = config.startTime.getTime();
      const endTime = startTime + config.durationMinutes * 60000;

      if (now < startTime && config.ranksFinalised) {
        await ExamConfig.updateOne({}, { $set: { ranksFinalised: false, archived: false } });
        return;
      }

      if (now > endTime) {
        if (!config.ranksFinalised || !config.archived) {
          await finalizeRanks();
        }
      }
    } catch (err) {
      console.error("❌ Watcher error:", err);
    }
  }, 30000);
}

// ============ ROUTES ============

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
        quizName: config.quizName || "Trivia Quiz",
        quizVersion: config.quizVersion || 1,
        archived: config.archived || false,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not fetch config" });
  }
});

app.post("/admin/config", async (req, res) => {
  try {
    const { startTime, durationMinutes, positiveMarks, negativeMarks, registrationFields, quizName, isQuizNameChanged } = req.body;
    if (!startTime || durationMinutes == null || positiveMarks == null || negativeMarks == null)
      return res.status(400).json({ success: false, message: "Missing required fields" });

    let config = await ExamConfig.findOne();
    if (!config) config = new ExamConfig();
    const oldQuizName = config.quizName || "Trivia Quiz";
    const newQuizName = quizName || "Trivia Quiz";

    if (isQuizNameChanged && oldQuizName !== newQuizName) {
      console.log(`🔄 Quiz name changed from "${oldQuizName}" to "${newQuizName}". Archiving attempts...`);

      let query = { submitted: true };
      if (oldQuizName === "Trivia Quiz") {
        query.$or = [
          { quizName: oldQuizName },
          { quizName: { $in: [null, "", undefined] } }
        ];
      } else {
        query.quizName = oldQuizName;
      }

      const attemptsToArchive = await QuizAttempt.find(query).lean();
      if (attemptsToArchive.length > 0) {
        const regNos = attemptsToArchive.map(a => a.studentRegNo);
        const students = await Student.find({ regNo: { $in: regNos } }).lean();
        const studentMap = {};
        students.forEach(s => {
          const custom = getCustomDataObject(s.customData);
          studentMap[s.regNo] = { name: custom.name || "", email: custom.email || "" };
        });

        const archivedDocs = attemptsToArchive.map(a => ({
          ...a,
          studentName: studentMap[a.studentRegNo]?.name || "",
          studentEmail: studentMap[a.studentRegNo]?.email || "",
          quizName: oldQuizName,
          archivedAt: new Date(),
        }));
        await ArchivedQuizAttempt.insertMany(archivedDocs);
        await QuizAttempt.deleteMany(query);
        console.log(`🗄️ Archived ${attemptsToArchive.length} attempts from "${oldQuizName}" before name change.`);
      }
      // Keep questions and students (they stay with their quizName)
    }

    // Update config
    config.quizName = newQuizName;
    config.startTime = new Date(startTime); // frontend should send ISO with offset
    config.durationMinutes = parseInt(durationMinutes);
    config.positiveMarks = parseFloat(positiveMarks);
    config.negativeMarks = parseFloat(negativeMarks);
    config.ranksFinalised = false;
    config.archived = false; // reset archive flag on new config

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

    // Rebuild CSVs for the new quiz
    await rebuildCsv(newQuizName);
    await rebuildRegistrationCsv(newQuizName);

    startRankWatcher();
    res.json({ success: true, config });
  } catch (err) {
    console.error("Config update error:", err);
    res.status(500).json({ success: false, message: "Update failed" });
  }
});

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
    const quizName = config.quizName || "Trivia Quiz";

    const student = new Student({ regNo, quizName, customData });
    await student.save();

    await rebuildRegistrationCsv(quizName);

    // PDF generation (unchanged)
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=reg-${regNo}.pdf`);
    doc.pipe(res);

    const bgPath = path.join(__dirname, "assets", "image.png");
    if (fs.existsSync(bgPath)) {
      doc.image(bgPath, 0, 0, { width: doc.page.width, height: doc.page.height });
    } else {
      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#f8f9fa");
    }

    const pageWidth = doc.page.width;
    const centerX = pageWidth / 2;

    doc.fontSize(28)
       .fillColor("#1a237e")
       .font("Helvetica-Bold")
       .text(quizName, centerX, 80, { align: "center" })
       .moveDown(0.5);

    doc.fontSize(18)
       .fillColor("#303f9f")
       .font("Helvetica")
       .text("Registration Confirmation", centerX, 130, { align: "center" })
       .moveDown(1);

    const cardX = 80;
    const cardY = 180;
    const cardWidth = pageWidth - 160;
    const cardHeight = 280;

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

    const startIST = config.startTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    doc.font("Helvetica-Bold").fillColor(labelColor);
    doc.text("Quiz Date & Time (IST):", leftCol, yPos);
    doc.font("Helvetica").fillColor(valueColor);
    doc.text(startIST, rightCol, yPos);
    yPos += 30;

    const noteY = cardY + cardHeight + 20;
    doc.strokeColor("#b0bec5")
       .lineWidth(1)
       .moveTo(80, noteY - 5)
       .lineTo(pageWidth - 80, noteY - 5)
       .stroke();

    doc.fontSize(16)
       .fillColor("#1a237e")
       .font("Helvetica-Bold")
       .text(" Login Credentials", centerX, noteY , { align: "center" });

    doc.fontSize(13)
       .fillColor("#37474f")
       .font("Helvetica")
       .text(
         "Your username is your Registration ID, and your password is your email address.",
         centerX-240,
         noteY + 40,
         { align: "center", width: pageWidth - 120 }
       );

    const rulesY = noteY + 90;
    doc.fontSize(16)
       .fillColor("#1a237e")
       .font("Helvetica-Bold")
       .text("Important Rules", centerX, rulesY, { align: "center" })
       .moveDown(0.5);

    const ruleFontSize = 12;
    const ruleColor = "#37474f";
    const bulletX = 70;
    let rulesYPos = rulesY + 40;

    const rules = [
      "The quiz will start exactly at the mentioned time.",
      `Total duration: ${config.durationMinutes} minutes.`,
      "You may navigate between questions freely.",
      "Use the 'Clear Answer' button to deselect your choice.",
      "Submit the quiz manually before the timer ends.",
      "Failure to submit will result in disqualification.",
      "Any malpractice leads to immediate disqualification."
    ];

    doc.fontSize(ruleFontSize)
       .fillColor(ruleColor)
       .font("Helvetica");

    rules.forEach((rule, i) => {
      const y = rulesYPos + i * 22;
      doc.text(`• ${rule}`, bulletX, y, { width: pageWidth - 140 });
    });

    const footerY = doc.page.height - 40;
    doc.fontSize(10)
       .fillColor("#78909c")
       .text("Generated by Trivia Quiz System", centerX, footerY, { align: "center" });

    doc.end();

  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

app.get("/questions-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
    const questions = await Question.find({ quizName }).sort({ createdAt: 1 }).lean();
    if (questions.length === 0) {
      return res.status(404).json({ success: false, message: "No questions found." });
    }

    const records = questions.map(q => ({
      question: q.question,
      optionA: q.options.A,
      optionB: q.options.B,
      optionC: q.options.C,
      optionD: q.options.D,
      correctAnswer: q.correctAnswer,
      imageUrl: q.imageUrl || "",
      published: q.published ? "Yes" : "No",
      createdAt: q.createdAt ? q.createdAt.toISOString() : "",
    }));

    const csvPath = path.join(resultsDir, `questions_${Date.now()}.csv`);
    const writer = createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: "question", title: "Question" },
        { id: "optionA", title: "Option A" },
        { id: "optionB", title: "Option B" },
        { id: "optionC", title: "Option C" },
        { id: "optionD", title: "Option D" },
        { id: "correctAnswer", title: "Correct Answer" },
        { id: "imageUrl", title: "Image URL" },
        { id: "published", title: "Published" },
        { id: "createdAt", title: "Created At" },
      ],
      append: false,
    });
    await writer.writeRecords(records);

    const downloadName = `questions_${new Date().toISOString().slice(0,10)}.csv`;
    res.download(csvPath, downloadName, (err) => {
      if (err) console.error("Download error:", err);
      fs.unlink(csvPath, (unlinkErr) => {
        if (unlinkErr) console.error("Failed to delete temp CSV:", unlinkErr);
      });
    });
  } catch (err) {
    console.error("Questions CSV error:", err);
    res.status(500).json({ success: false, message: "Server error: " + err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { regNo, email } = req.body;
    if (!regNo || !email) {
      return res.status(400).json({ success: false, message: "Registration number and email are required." });
    }

    const student = await Student.findOne({ regNo });
    if (!student) {
      return res.status(404).json({ success: false, message: "Invalid registration number." });
    }

    const storedEmail = student.customData.get('email');
    if (!storedEmail || storedEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(401).json({ success: false, message: "Email does not match our records." });
    }

    const existing = await QuizAttempt.findOne({ studentRegNo: regNo, submitted: true });
    if (existing) {
      return res.status(403).json({ success: false, message: "You have already submitted the quiz." });
    }

    const config = await getExamConfig();
    res.json({
      success: true,
      student: { regNo: student.regNo, customData: Object.fromEntries(student.customData || new Map()) },
      examStartTime: config.startTime,
      examDuration: config.durationMinutes,
      positiveMarks: config.positiveMarks,
      negativeMarks: config.negativeMarks,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Login failed." });
  }
});

app.get("/get-questions", async (req, res) => {
  try {
    const config = await getExamConfig();
    const now = new Date();
    if (now < config.startTime) return res.status(403).json({ success: false, message: "Quiz not started" });
    const questions = await Question.find({ published: true, quizName: config.quizName }).sort({ createdAt: 1 });
    res.json({ success: true, questions, positiveMarks: config.positiveMarks, negativeMarks: config.negativeMarks });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

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
        quizName: config.quizName || "Trivia Quiz",
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

app.post("/submit-quiz", async (req, res) => {
  try {
    const { regNo, answers, auto } = req.body; // 👈 accept 'auto' flag
    if (!regNo || !answers) return res.status(400).json({ success: false, message: "Missing data" });

    const now = new Date();
    const config = await getExamConfig();
    const attempt = await QuizAttempt.findOne({ studentRegNo: regNo, submitted: false });
    if (!attempt) return res.status(404).json({ success: false, message: "No active quiz session" });

    const studentEnd = new Date(attempt.startTime.getTime() + attempt.durationMinutes * 60000);

    // Determine disqualification based on auto flag
    let disqualified = false;
    if (auto) {
      // Auto-submit: disqualify if at or after end time
      disqualified = now >= studentEnd;
    } else {
      // Manual submit: disqualify only if strictly after end time (allows last-second click)
      disqualified = now > studentEnd;
    }

    if (disqualified) {
      attempt.disqualified = true;
      attempt.score = -1;
      attempt.totalMarksObtained = -1;
      attempt.totalTimeMinutes = Math.round(((now - attempt.startTime) / 60000) * 100) / 100;
      attempt.submitted = true;
      attempt.endTime = now;
      attempt.answers = answers;
      attempt.rank = -1;
      await attempt.save();
      await ExamConfig.updateOne({}, { $set: { ranksFinalised: false, archived: false } });
      await rebuildCsv(config.quizName || "Trivia Quiz");
      await finalizeRanks();
      return res.json({ success: true, disqualified: true, message: "Time expired. You are disqualified." });
    }

    // ---------- Normal scoring (unchanged from your original) ----------
    const questions = await Question.find({ published: true, quizName: config.quizName }).sort({ createdAt: 1 });
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
    attempt.rank = null;
    await attempt.save();

    await ExamConfig.updateOne({}, { $set: { ranksFinalised: false, archived: false } });
    await rebuildCsv(config.quizName || "Trivia Quiz");
    await finalizeRanks();

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

app.post("/finalize-ranks", async (req, res) => {
  try {
    await finalizeRanks();
    res.json({ success: true, message: "Ranks finalised manually." });
  } catch (err) {
    console.error("Finalise ranks error:", err);
    res.status(500).json({ success: false, message: "Rank finalisation failed" });
  }
});

app.post("/admin/archive-and-clear", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";

    const attempts = await QuizAttempt.find({ submitted: true, quizName }).lean();
    if (attempts.length === 0) {
      return res.status(400).json({ success: false, message: "No attempts to archive." });
    }

    const regNos = attempts.map(a => a.studentRegNo);
    const students = await Student.find({ regNo: { $in: regNos } }).lean();
    const studentMap = {};
    students.forEach(s => {
      const custom = getCustomDataObject(s.customData);
      studentMap[s.regNo] = { name: custom.name || "", email: custom.email || "" };
    });

    const archivedDocs = attempts.map(a => ({
      ...a,
      studentName: studentMap[a.studentRegNo]?.name || "",
      studentEmail: studentMap[a.studentRegNo]?.email || "",
      archivedAt: new Date(),
    }));
    await ArchivedQuizAttempt.insertMany(archivedDocs);
    await QuizAttempt.deleteMany({ quizName });
    console.log(`🗄️ Archived ${attempts.length} attempts for "${quizName}" and cleared.`);

    await ExamConfig.updateOne({}, { $set: { ranksFinalised: false, archived: true } });
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

app.delete("/admin/archived-quizzes/:quizName", async (req, res) => {
  try {
    const { quizName } = req.params;
    const result = await ArchivedQuizAttempt.deleteMany({ quizName });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "No archived attempts found for this quiz." });
    }

    const sanitized = quizName.replace(/[^a-zA-Z0-9-_]/g, "_");
    const patterns = [
      `archived_results_${sanitized}.csv`,
      `archived_registrations_${sanitized}.csv`,
      `archived_questions_${sanitized}.csv`
    ];
    patterns.forEach(file => {
      const filePath = path.join(resultsDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted archived CSV: ${filePath}`);
      }
    });

    res.json({
      success: true,
      message: `Deleted archived quiz "${quizName}" (${result.deletedCount} attempts).`
    });
  } catch (err) {
    console.error("Delete archived quiz error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/admin/archived-quizzes", async (req, res) => {
  try {
    const archivedAttemptsAgg = await ArchivedQuizAttempt.aggregate([
      {
        $group: {
          _id: "$quizName",
          startTime: { $min: "$startTime" },
          endTime: { $max: "$endTime" },
          durationMinutes: { $avg: "$durationMinutes" },
          attemptsCount: { $sum: 1 },
        },
      },
      {
        $project: {
          quizName: "$_id",
          startTime: 1,
          endTime: 1,
          durationMinutes: { $round: ["$durationMinutes", 0] },
          attemptsCount: 1,
          _id: 0,
        },
      },
    ]);

    const questionAgg = await Question.aggregate([
      {
        $group: {
          _id: {
            $cond: {
              if: { $or: [{ $eq: ["$quizName", null] }, { $eq: ["$quizName", ""] }, { $eq: ["$quizName", undefined] }] },
              then: "Trivia Quiz",
              else: "$quizName"
            }
          },
          questionsCount: { $sum: 1 },
        },
      },
      {
        $project: {
          quizName: "$_id",
          questionsCount: 1,
          _id: 0,
        },
      },
    ]);

    const studentAgg = await Student.aggregate([
      {
        $group: {
          _id: {
            $cond: {
              if: { $or: [{ $eq: ["$quizName", null] }, { $eq: ["$quizName", ""] }, { $eq: ["$quizName", undefined] }] },
              then: "Trivia Quiz",
              else: "$quizName"
            }
          },
          studentsCount: { $sum: 1 },
        },
      },
      {
        $project: {
          quizName: "$_id",
          studentsCount: 1,
          _id: 0,
        },
      },
    ]);

    const quizMap = new Map();

    archivedAttemptsAgg.forEach(item => {
      const key = item.quizName || "Trivia Quiz";
      quizMap.set(key, {
        quizName: key,
        startTime: item.startTime,
        endTime: item.endTime,
        durationMinutes: item.durationMinutes || 0,
        attemptsCount: item.attemptsCount,
        questionsCount: 0,
        studentsCount: 0,
      });
    });

    questionAgg.forEach(item => {
      const key = item.quizName || "Trivia Quiz";
      if (quizMap.has(key)) {
        quizMap.get(key).questionsCount = item.questionsCount;
      }
    });

    studentAgg.forEach(item => {
      const key = item.quizName || "Trivia Quiz";
      if (quizMap.has(key)) {
        quizMap.get(key).studentsCount = item.studentsCount;
      }
    });

    const quizzes = Array.from(quizMap.values())
      .filter(q => q.quizName && q.quizName.trim() !== "")
      .filter(q => q.attemptsCount > 0)
      .sort((a, b) => {
        if (a.startTime && b.startTime) return new Date(b.startTime) - new Date(a.startTime);
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return a.quizName.localeCompare(b.quizName);
      });

    res.json({ success: true, quizzes });
  } catch (err) {
    console.error("Archived quizzes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/admin/archived-csv/:quizName", async (req, res) => {
  try {
    const { quizName } = req.params;
    const attempts = await ArchivedQuizAttempt.find({ quizName }).sort({ rank: 1 }).lean();
    if (!attempts.length) {
      return res.status(404).json({ success: false, message: "No archived attempts for this quiz." });
    }

    const records = attempts.map(a => ({
      regNo: a.studentRegNo,
      name: a.studentName || "",
      email: a.studentEmail || "",
      correctCount: a.score || 0,
      wrongCount: (a.answers || []).filter((ans, idx) => ans !== null && ans !== "?").length - (a.score || 0),
      totalMarksObtained: a.totalMarksObtained || 0,
      totalMarks: a.totalMarks || 0,
      totalTimeMinutes: a.totalTimeMinutes || 0,
      rank: a.rank || 0,
      submissionTime: a.endTime ? a.endTime.toISOString() : "",
      disqualified: a.disqualified ? "YES" : "NO",
    }));

    const csvPath = path.join(resultsDir, `archived_results_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`);
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
        { id: "submissionTime", title: "SubmissionTime" },
        { id: "disqualified", title: "Disqualified" },
      ],
      append: false,
    });
    await writer.writeRecords(records);

    const downloadName = `archived_results_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    res.download(csvPath, downloadName, (err) => {
      if (err) console.error("Download error:", err);
      fs.unlink(csvPath, (unlinkErr) => {
        if (unlinkErr) console.error("Failed to delete temp CSV:", unlinkErr);
      });
    });
  } catch (err) {
    console.error("Archived results CSV error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/admin/archived-registrations-csv/:quizName", async (req, res) => {
  try {
    const { quizName } = req.params;
    let query = { quizName: quizName };
    if (quizName === "Trivia Quiz") {
      query = { $or: [{ quizName: quizName }, { quizName: { $in: [null, "", undefined] } }] };
    }
    const students = await Student.find(query).sort({ registeredAt: 1 }).lean();

    if (!students.length) {
      return res.status(404).json({ success: false, message: "No registrations found for this quiz." });
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

    const csvPath = path.join(resultsDir, `archived_registrations_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`);
    const writer = createObjectCsvWriter({
      path: csvPath,
      header,
      append: false,
    });
    await writer.writeRecords(records);

    const downloadName = `archived_registrations_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    res.download(csvPath, downloadName, (err) => {
      if (err) console.error("Download error:", err);
      fs.unlink(csvPath, (unlinkErr) => {
        if (unlinkErr) console.error("Failed to delete temp CSV:", unlinkErr);
      });
    });
  } catch (err) {
    console.error("Archived registrations CSV error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/admin/archived-questions-csv/:quizName", async (req, res) => {
  try {
    const { quizName } = req.params;
    let query = { quizName: quizName };
    if (quizName === "Trivia Quiz") {
      query = { $or: [{ quizName: quizName }, { quizName: { $in: [null, "", undefined] } }] };
    }
    const questions = await Question.find(query).sort({ createdAt: 1 }).lean();
    if (!questions.length) {
      return res.status(404).json({ success: false, message: "No questions found for this quiz." });
    }

    const records = questions.map(q => ({
      question: q.question,
      optionA: q.options.A,
      optionB: q.options.B,
      optionC: q.options.C,
      optionD: q.options.D,
      correctAnswer: q.correctAnswer,
      imageUrl: q.imageUrl || "",
      published: q.published ? "Yes" : "No",
      createdAt: q.createdAt ? q.createdAt.toISOString() : "",
    }));

    const csvPath = path.join(resultsDir, `archived_questions_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`);
    const writer = createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: "question", title: "Question" },
        { id: "optionA", title: "Option A" },
        { id: "optionB", title: "Option B" },
        { id: "optionC", title: "Option C" },
        { id: "optionD", title: "Option D" },
        { id: "correctAnswer", title: "Correct Answer" },
        { id: "imageUrl", title: "Image URL" },
        { id: "published", title: "Published" },
        { id: "createdAt", title: "Created At" },
      ],
      append: false,
    });
    await writer.writeRecords(records);

    const downloadName = `archived_questions_${quizName.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;
    res.download(csvPath, downloadName, (err) => {
      if (err) console.error("Download error:", err);
      fs.unlink(csvPath, (unlinkErr) => {
        if (unlinkErr) console.error("Failed to delete temp CSV:", unlinkErr);
      });
    });
  } catch (err) {
    console.error("Archived questions CSV error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/admin/reset-config', async (req, res) => {
  res.json({ success: true, message: 'Config reset locally.' });
});

app.post("/admin/reset-exam", async (req, res) => {
  try {
    let config = await ExamConfig.findOne();
    if (!config) {
      config = new ExamConfig({
        quizName: "Trivia Quiz",
        startTime: new Date(Date.now() + 5 * 60000),
        durationMinutes: 30,
        positiveMarks: 1,
        negativeMarks: 0,
        registrationFields: new Map(),
        quizVersion: 1,
      });
      await config.save();
    }

    const oldQuizName = config.quizName || "Trivia Quiz";
    console.log(`🔄 Resetting exam for quiz: "${oldQuizName}"`);

    let query = { submitted: true };
    if (oldQuizName === "Trivia Quiz") {
      query.$or = [
        { quizName: oldQuizName },
        { quizName: { $in: [null, "", undefined] } }
      ];
    } else {
      query.quizName = oldQuizName;
    }

    const attemptsToArchive = await QuizAttempt.find(query).lean();
    if (attemptsToArchive.length > 0) {
      const regNos = attemptsToArchive.map(a => a.studentRegNo);
      const students = await Student.find({ regNo: { $in: regNos } }).lean();
      const studentMap = {};
      students.forEach(s => {
        const custom = getCustomDataObject(s.customData);
        studentMap[s.regNo] = { name: custom.name || "", email: custom.email || "" };
      });

      const archivedDocs = attemptsToArchive.map(a => ({
        ...a,
        studentName: studentMap[a.studentRegNo]?.name || "",
        studentEmail: studentMap[a.studentRegNo]?.email || "",
        quizName: oldQuizName,
        archivedAt: new Date(),
      }));
      await ArchivedQuizAttempt.insertMany(archivedDocs);
      await QuizAttempt.deleteMany(query);
      console.log(`📦 Auto‑archived ${attemptsToArchive.length} attempts for "${oldQuizName}" before reset.`);
    }

    await Student.deleteMany({ quizName: oldQuizName });

    const newVersion = (config.quizVersion || 1) + 1;
    config.quizVersion = newVersion;
    await Counter.findOneAndUpdate(
      { _id: `regNo_${newVersion}` },
      { $set: { seq: 0 } },
      { upsert: true }
    );

    const now = new Date();
    const newStart = new Date(now.getTime() + 5 * 60000);
    config.startTime = newStart;
    config.ranksFinalised = false;
    config.archived = false;
    config.durationMinutes = 30;
    config.positiveMarks = 1;
    config.negativeMarks = 0;

    if (req.body?.quizName) {
      config.quizName = req.body.quizName;
    }
    await config.save();

    await rebuildCsv(config.quizName);
    await rebuildRegistrationCsv(config.quizName);

    startRankWatcher();

    res.json({
      success: true,
      message: `Exam reset. New version: ${newVersion}. New start time: ${newStart.toISOString()}. Archived ${attemptsToArchive.length} old attempts. Questions kept.`,
      startTime: newStart,
      quizVersion: newVersion,
    });
  } catch (err) {
    console.error("❌ Reset exam error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

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
    const count = await Question.countDocuments({ quizName: config.quizName });
    if (count === 0) {
      return res.status(400).json({
        success: false,
        message: "No questions to publish. Add at least one question first."
      });
    }
    const result = await Question.updateMany({ quizName: config.quizName }, { $set: { published: true } });
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

app.get("/admin/disqualified-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";

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

app.get("/admin/list-csvs", async (req, res) => {
  try {
    const files = fs.readdirSync(resultsDir);
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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

app.get("/debug-attempt/:regNo", async (req, res) => {
  try {
    const attempt = await QuizAttempt.findOne({ studentRegNo: req.params.regNo });
    if (!attempt) return res.status(404).json({ success: false, message: "No attempt found" });
    res.json(attempt);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/finalize-quiz", async (req, res) => {
  try {
    const now = new Date();
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
    const overdue = await QuizAttempt.find({ submitted: false, startTime: { $exists: true }, quizName });
    let finalized = 0;

    for (let a of overdue) {
      const end = new Date(a.startTime.getTime() + a.durationMinutes * 60000);
      if (now > end) {
        a.disqualified = true;
        a.score = -1;
        a.totalMarksObtained = -1;
        a.totalTimeMinutes = Math.round(((end - a.startTime) / 60000) * 100) / 100;
        a.submitted = true;
        a.endTime = end;
        a.rank = -1;
        await a.save();
        finalized++;
      }
    }

    if (finalized > 0) {
      await ExamConfig.updateOne({}, { $set: { ranksFinalised: false, archived: false } });
      await rebuildCsv(quizName);
      await finalizeRanks();
    }

    res.json({ success: true, message: `${finalized} overdue attempts finalized` });
  } catch (err) {
    console.error("Finalization error:", err);
    res.status(500).json({ success: false, message: "Finalization failed" });
  }
});

app.get("/results-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
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

app.get("/registrations-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
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

app.get("/available-results", async (req, res) => {
  try {
    const files = fs.readdirSync(resultsDir);
    const csvFiles = files.filter(f => f.startsWith("results_") && f.endsWith(".csv"));
    res.json({ success: true, files: csvFiles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/admin/clear-csv", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
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
    archived: config.archived || false,
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
      ranksFinalised: config.ranksFinalised,
      archived: config.archived || false,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============ CRUD ROUTES FOR QUESTIONS ============
app.get("/questions", async (req, res) => {
  try {
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
    const questions = await Question.find({ quizName }).sort({ createdAt: -1 });
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
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
    let imageUrl = "";
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }
    const newQuestion = new Question({
      question, options, correctAnswer, imageUrl,
      published: false,
      quizName
    });
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
    const config = await getExamConfig();
    const quizName = config.quizName || "Trivia Quiz";
    const updateData = { question, options, correctAnswer, quizName };
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
    console.log(`⏰ Quiz start (UTC): ${c.startTime.toISOString()}`)
  );
});
