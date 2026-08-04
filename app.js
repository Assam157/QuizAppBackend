  import React from "react";
import { useNavigate } from "react-router-dom";

function RulesPage() {
  const navigate = useNavigate();

  return (
    <div style={styles.page}>
      <div style={styles.bgCircle1} />
      <div style={styles.bgCircle2} />

      <div style={styles.card}>
        {/* Back to Home */}
        <button style={styles.backBtn} onClick={() => navigate("/")}>
          ← Back to Home
        </button>

        <h1 style={styles.title}>📜 NSTAD Online Quiz – Rules & Regulations</h1>
        <p style={styles.subtitle}>
          Please read all rules carefully before starting the quiz.
        </p>

        {/* Rules List – all content from original */}
        <div style={styles.rulesContainer}>
          <div style={styles.rulesGrid}>
            <div style={styles.ruleCard}>
              <div style={styles.ruleNumber}>01</div>
              <div style={styles.ruleContent}>
                <strong>Eligibility:</strong> Open to students of Class XI, Class XII, and Undergraduates from any recognized institution. Participation is free and only one entry per participant.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #e17055, #d63031)" }}>02</div>
              <div style={styles.ruleContent}>
                <strong>Quiz Format:</strong> Multiple-choice questions (MCQs) based on archival documents of Acharya Prafulla Chandra Ray. Explore{" "}
                <a href="https://www.nstad.in" target="_blank" rel="noopener noreferrer" style={{ color: "#6c5ce7", fontWeight: 600 }}>
                  www.nstad.in
                </a>{" "}
                beforehand.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #00b894, #00cec9)" }}>03</div>
              <div style={styles.ruleContent}>
                <strong>Submission Guidelines:</strong> The quiz will be available only on the scheduled date and time. Responses submitted after the closing time will not be considered. Once submitted, answers cannot be changed.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #fdcb6e, #e17055)" }}>04</div>
              <div style={styles.ruleContent}>
                <strong>Time:</strong> 25 MCQs will appear one by one. Duration is 25 minutes – the quiz will automatically close at the end time.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #6c5ce7, #a29bfe)" }}>05</div>
              <div style={styles.ruleContent}>
                <strong>Evaluation:</strong> +1 for each correct answer, <strong>−1</strong> for each wrong answer (negative marking). In case of a tie, earlier submission time gets preference.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #e17055, #fdcb6e)" }}>06</div>
              <div style={styles.ruleContent}>
                <strong>Fair Participation:</strong> Answer independently. Unfair means or multiple entries may lead to disqualification. Organizers reserve the right to verify details.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #2d3436, #636e72)" }}>07</div>
              <div style={styles.ruleContent}>
                <strong>Results:</strong> Winners are decided by highest score; if tied, faster response time wins. The organizing committee’s decision is final.
              </div>
            </div>
            <div style={styles.ruleCard}>
              <div style={{ ...styles.ruleNumber, background: "linear-gradient(135deg, #6c5ce7, #5a4bd1)" }}>08</div>
              <div style={styles.ruleContent}>
                <strong>Disclaimer:</strong> By participating, you agree to abide by these rules. Organizers are not responsible for poor internet connectivity. No extensions will be granted. The quiz may be modified or cancelled without prior notice.
              </div>
            </div>
          </div>

          {/* Prominent NSTAD link */}
          <div style={styles.nstadBox}>
            📌 Explore the National Science and Technology Digital Archive:{" "}
            <a href="https://www.nstad.in" target="_blank" rel="noopener noreferrer" style={styles.nstadLink}>
              www.nstad.in
            </a>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={styles.actionGroup}>
          <button
            style={styles.primaryBtn}
            onClick={() => navigate("/register")}
            onMouseEnter={(e) => {
              e.target.style.transform = "translateY(-3px)";
              e.target.style.boxShadow = "0 8px 25px rgba(108, 92, 231, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 4px 15px rgba(108, 92, 231, 0.25)";
            }}
          >
            📝 Register Now
          </button>
          <button
            style={styles.secondaryBtn}
            onClick={() => navigate("/login")}
            onMouseEnter={(e) => {
              e.target.style.transform = "translateY(-3px)";
              e.target.style.boxShadow = "0 8px 25px rgba(46, 213, 115, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 4px 15px rgba(46, 213, 115, 0.25)";
            }}
          >
            🔑 Student Login
          </button>
        </div>
      </div>
    </div>
  );
}

export default RulesPage;

const styles = {
  page: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f0c29, #1a1a40, #24243e)",
    fontFamily: "'Segoe UI', 'Inter', system-ui, sans-serif",
    padding: "24px",
    position: "relative",
    overflow: "hidden",
  },
  bgCircle1: {
    position: "absolute",
    width: "350px",
    height: "350px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(108,92,231,0.25) 0%, transparent 70%)",
    top: "-80px",
    right: "-60px",
    pointerEvents: "none",
  },
  bgCircle2: {
    position: "absolute",
    width: "280px",
    height: "280px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(46,213,115,0.2) 0%, transparent 70%)",
    bottom: "-70px",
    left: "-50px",
    pointerEvents: "none",
  },
  card: {
    maxWidth: "620px",
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: "20px",
    padding: "40px 36px 32px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.1) inset",
    textAlign: "center",
    position: "relative",
    zIndex: 1,
    backdropFilter: "blur(10px)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
  },
  backBtn: {
    alignSelf: "flex-start",
    background: "none",
    border: "none",
    color: "#6c5ce7",
    fontSize: "15px",
    fontWeight: "700",
    cursor: "pointer",
    marginBottom: "12px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  title: {
    fontSize: "24px",
    fontWeight: "800",
    color: "#1a1a2e",
    margin: "0 0 8px",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    color: "#5a5a7a",
    fontSize: "15px",
    marginBottom: "20px",
  },
  rulesContainer: {
    flex: "1 1 auto",
    overflowY: "auto",
    marginBottom: "20px",
    paddingRight: "4px",
  },
  rulesGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    textAlign: "left",
  },
  ruleCard: {
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
    backgroundColor: "#faf9ff",
    borderRadius: "12px",
    padding: "14px 16px",
    border: "1px solid #eeeafc",
  },
  ruleNumber: {
    flexShrink: 0,
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    background: "linear-gradient(135deg, #6c5ce7, #a29bfe)",
    color: "#fff",
    fontWeight: "800",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ruleContent: {
    flex: 1,
    fontSize: "14px",
    lineHeight: "1.6",
    color: "#333",
  },
  nstadBox: {
    marginTop: "16px",
    backgroundColor: "#eef2ff",
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "14px",
    color: "#1a237e",
    borderLeft: "4px solid #6c5ce7",
    textAlign: "left",
  },
  nstadLink: {
    color: "#6c5ce7",
    fontWeight: 700,
    textDecoration: "underline",
  },
  actionGroup: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
    flexWrap: "wrap",
    marginTop: "10px",
  },
  primaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 28px",
    fontSize: "15px",
    fontWeight: "700",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #6c5ce7, #5a4bd1)",
    color: "#fff",
    boxShadow: "0 4px 15px rgba(108, 92, 231, 0.25)",
    transition: "all 0.25s ease",
  },
  secondaryBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 28px",
    fontSize: "15px",
    fontWeight: "700",
    borderRadius: "12px",
    border: "2px solid #e0dcee",
    cursor: "pointer",
    background: "#fff",
    color: "#4a4a6a",
    boxShadow: "0 4px 15px rgba(0,0,0,0.05)",
    transition: "all 0.25s ease",
  },
};
