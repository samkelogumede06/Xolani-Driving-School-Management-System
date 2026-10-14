/**
 * Xolani Driving School — Prediction Engine
 * Two rule-based models: Test Readiness + Dropout Risk,
 * calculated from each student's real lesson, enrollment and payment records.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Turn raw database rows into model inputs.
 * @param {object}   opts
 * @param {object[]} opts.lessons    rows from `lessons` for this student
 * @param {object}   opts.enrollment active enrollment joined with package lesson_count (or null)
 * @param {Date}     opts.createdAt  when the student's profile was created
 * @param {Date}     [opts.now]
 */
function buildStudentInputs({ lessons = [], enrollment = null, createdAt = null, now = new Date() }) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const byDate = [...lessons].sort((a, b) => toDate(a.scheduled_date) - toDate(b.scheduled_date));

  // Lessons that have actually happened (attended) or were missed (no-show)
  const resolved = byDate.filter(l => ['completed', 'in_progress', 'no_show'].includes(l.status));
  const attended = resolved.filter(l => l.status !== 'no_show');
  const missed = resolved.filter(l => l.status === 'no_show');
  const completed = byDate.filter(l => l.status === 'completed');
  const upcoming = byDate.filter(l => l.status === 'scheduled' && toDate(l.scheduled_date) >= todayStart);

  const scores = completed.filter(l => l.student_score != null).map(l => Number(l.student_score));

  // Consecutive no-shows, counting back from the most recent resolved lesson
  let consecutiveMissed = 0;
  for (let i = resolved.length - 1; i >= 0 && resolved[i].status === 'no_show'; i--) consecutiveMissed++;

  // Compare attendance of the last 3 resolved lessons with the ones before them
  let attendanceTrend = 'stable';
  if (resolved.length >= 6) {
    const rate = list => list.filter(l => l.status !== 'no_show').length / list.length;
    const diff = rate(resolved.slice(-3)) - rate(resolved.slice(0, -3));
    if (diff <= -0.2) attendanceTrend = 'declining';
    else if (diff >= 0.2) attendanceTrend = 'improving';
  }

  const lastActivity = attended.length
    ? toDate(attended[attended.length - 1].scheduled_date)
    : (enrollment?.start_date ? toDate(enrollment.start_date) : (createdAt ? toDate(createdAt) : now));
  const daysSinceLastLesson = Math.max(0, Math.floor((todayStart - lastActivity) / DAY_MS));

  const paid = parseFloat(enrollment?.total_paid) || 0;
  const balance = parseFloat(enrollment?.balance_due) || 0;

  return {
    readiness: {
      lessonsCompleted: completed.length,
      totalLessons: enrollment?.lesson_count || 10,
      attendanceRate: resolved.length ? (attended.length / resolved.length) * 100 : 0,
      averageScore: average(scores),
      recentScores: scores.slice(-3),
      scoreTrend: scores.length >= 2 ? scores[scores.length - 1] - scores[0] : 0,
      missedLessons: missed.length,
      yardTestPassed: completed.some(l => l.lesson_type === 'yard_test' && Number(l.student_score) >= 50)
    },
    dropout: {
      missedLessonsCount: missed.length,
      totalResolvedLessons: resolved.length,
      consecutiveMissedLessons: consecutiveMissed,
      daysSinceLastLesson,
      hasUpcomingLesson: upcoming.length > 0,
      outstandingBalanceRatio: paid + balance > 0 ? balance / (paid + balance) : 0,
      attendanceTrend
    }
  };
}

function calculateTestReadiness(d = {}) {
  const {
    lessonsCompleted = 0, totalLessons = 10,
    attendanceRate = 0, averageScore = 0,
    recentScores = [], scoreTrend = 0,
    missedLessons = 0, yardTestPassed = false
  } = d;

  const lessonProgress = Math.min((lessonsCompleted / Math.max(totalLessons, 1)) * 100, 100);
  const recentAvg = recentScores.length ? average(recentScores) : averageScore;
  const trendScore = Math.max(0, Math.min(scoreTrend * 2 + 50, 100));

  let raw = (lessonProgress * 0.30) + (attendanceRate * 0.20) + (averageScore * 0.25) +
            (recentAvg * 0.20) + (trendScore * 0.05);

  if (yardTestPassed) raw = Math.min(raw + 5, 100);
  raw = Math.max(raw - missedLessons * 2, 0);
  const score = Math.round(Math.min(raw, 100));

  let classification, recommendations, passProbability;
  if (score >= 85) {
    classification = 'Ready'; passProbability = Math.min(score + 5, 99);
    recommendations = ['Excellent! You are ready for your road test.','Book your road test through the admin office.','Continue practising emergency stops and parking.','Review the K53 manual one final time.'];
  } else if (score >= 70) {
    classification = 'Nearly Ready'; passProbability = score - 5;
    recommendations = ['Good progress — a few more lessons recommended.','Focus on areas your instructor noted as weak.','Practise yard manoeuvres until fully confident.','Aim for consistent scores above 75% in practice tests.'];
  } else if (score >= 50) {
    classification = 'In Progress'; passProbability = Math.max(score - 15, 10);
    recommendations = ['Keep practising — you are making progress.','Increase lesson frequency for faster improvement.','Focus on defensive driving techniques.','Complete all scheduled lessons before considering a road test.'];
  } else {
    classification = 'Needs More Training'; passProbability = Math.max(score - 20, 5);
    recommendations = ['More training required before road test.','Discuss your progress with your instructor.','Consider additional lessons in specific weak areas.','Maintain consistent attendance for best results.'];
  }

  return { score, passProbability, classification, recommendations,
    breakdown: { lessonProgress: Math.round(lessonProgress), attendanceRate: Math.round(attendanceRate), averageScore: Math.round(averageScore), recentPerformance: Math.round(recentAvg) },
    generatedAt: new Date().toISOString() };
}

function calculateDropoutRisk(d = {}) {
  const {
    missedLessonsCount = 0, totalResolvedLessons = 0,
    consecutiveMissedLessons = 0, daysSinceLastLesson = 0,
    hasUpcomingLesson = false, outstandingBalanceRatio = 0,
    attendanceTrend = 'stable'
  } = d;

  const missedRate = missedLessonsCount / Math.max(totalResolvedLessons, 1);

  let riskScore = 0;
  riskScore += missedRate * 30;
  if (consecutiveMissedLessons >= 3) riskScore += 30;
  else if (consecutiveMissedLessons === 2) riskScore += 20;
  else if (consecutiveMissedLessons === 1) riskScore += 10;
  // A booked upcoming lesson means the student is still engaged
  if (!hasUpcomingLesson) {
    if (daysSinceLastLesson > 30) riskScore += 25;
    else if (daysSinceLastLesson > 14) riskScore += 15;
    else if (daysSinceLastLesson > 7) riskScore += 5;
  }
  riskScore += outstandingBalanceRatio * 20;
  if (attendanceTrend === 'declining') riskScore += 15;
  else if (attendanceTrend === 'improving') riskScore -= 10;
  riskScore = Math.max(0, Math.min(riskScore, 100));

  let riskLevel, riskColor, recommendations;
  if (riskScore >= 65) {
    riskLevel = 'High Risk'; riskColor = 'danger';
    recommendations = ['Urgent: Contact this student immediately.','Offer a flexible payment arrangement if needed.','Schedule a meeting to address any concerns.','Consider a motivational session or counselling.'];
  } else if (riskScore >= 35) {
    riskLevel = 'Medium Risk'; riskColor = 'warning';
    recommendations = ['Send a reminder message or call the student.','Check for scheduling conflicts or personal issues.','Offer to reschedule missed lessons.','Monitor attendance closely over the next 2 weeks.'];
  } else {
    riskLevel = 'Low Risk'; riskColor = 'success';
    recommendations = ['Student is on track — keep up the great work!','Continue regular lesson scheduling.','Celebrate milestones to maintain motivation.'];
  }

  return { riskScore: Math.round(riskScore), riskLevel, riskColor, recommendations,
    factors: { missedLessonsRate: Math.round(missedRate * 100), consecutiveMisses: consecutiveMissedLessons, daysSinceLastLesson, paymentIssues: Math.round(outstandingBalanceRatio * 100), trend: attendanceTrend },
    generatedAt: new Date().toISOString() };
}

function predictStudent(data) {
  const inputs = buildStudentInputs(data);
  return {
    testReadiness: calculateTestReadiness(inputs.readiness),
    dropoutRisk: calculateDropoutRisk(inputs.dropout)
  };
}

module.exports = { buildStudentInputs, calculateTestReadiness, calculateDropoutRisk, predictStudent };
