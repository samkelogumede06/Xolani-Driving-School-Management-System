/**
 * Xolani Driving School — AI Prediction Engine
 * Two algorithms: Test Readiness + Dropout Risk
 */

function calculateTestReadiness(d = {}) {
  const {
    lessonsCompleted = 0, totalLessons = 10,
    attendanceRate = 0, averageScore = 0,
    instructorRating = 0, missedLessons = 0,
    yardTestPassed = false, practiceTestScores = []
  } = d;

  const lessonProgress = Math.min((lessonsCompleted / Math.max(totalLessons, 1)) * 100, 100);
  const recentScores = practiceTestScores.slice(-3);
  const recentAvg = recentScores.length > 0 ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : averageScore;
  const improvement = practiceTestScores.length >= 2
    ? practiceTestScores[practiceTestScores.length - 1] - practiceTestScores[0] : 0;

  let raw = (lessonProgress * 0.25) + (attendanceRate * 0.20) + (averageScore * 0.25) +
            (instructorRating * 0.15) + (recentAvg * 0.10) +
            (Math.max(0, Math.min(improvement * 2 + 50, 100)) * 0.05);

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
    breakdown: { lessonProgress: Math.round(lessonProgress), attendanceRate: Math.round(attendanceRate), averageScore: Math.round(averageScore), instructorRating: Math.round(instructorRating), recentPerformance: Math.round(recentAvg) },
    generatedAt: new Date().toISOString() };
}

function calculateDropoutRisk(d = {}) {
  const {
    missedLessonsCount = 0, totalScheduledLessons = 1,
    consecutiveMissedLessons = 0, daysSinceLastLesson = 0,
    paymentsMissed = 0, totalPaymentsDue = 1,
    attendanceTrend = 'stable'
  } = d;

  let riskScore = 0;
  riskScore += (missedLessonsCount / Math.max(totalScheduledLessons, 1)) * 30;
  if (consecutiveMissedLessons >= 3) riskScore += 30;
  else if (consecutiveMissedLessons === 2) riskScore += 20;
  else if (consecutiveMissedLessons === 1) riskScore += 10;
  if (daysSinceLastLesson > 30) riskScore += 25;
  else if (daysSinceLastLesson > 14) riskScore += 15;
  else if (daysSinceLastLesson > 7) riskScore += 5;
  riskScore += (paymentsMissed / Math.max(totalPaymentsDue, 1)) * 20;
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
    factors: { missedLessonsRate: Math.round((missedLessonsCount/Math.max(totalScheduledLessons,1))*100), consecutiveMisses: consecutiveMissedLessons, daysSinceLastLesson, paymentIssues: Math.round((paymentsMissed/Math.max(totalPaymentsDue,1))*100), trend: attendanceTrend },
    generatedAt: new Date().toISOString() };
}

function generateDemoPrediction(studentId = '') {
  const seed = studentId ? (studentId.charCodeAt(0) + studentId.charCodeAt(1)) % 40 : 20;
  return {
    testReadiness: calculateTestReadiness({
      lessonsCompleted: 5 + (seed % 8), totalLessons: 10,
      attendanceRate: 70 + (seed % 25), averageScore: 65 + (seed % 28),
      instructorRating: 70 + (seed % 22), missedLessons: seed % 3,
      practiceTestScores: [55 + seed%15, 60 + seed%18, 65 + seed%20]
    }),
    dropoutRisk: calculateDropoutRisk({
      missedLessonsCount: seed % 3, totalScheduledLessons: 8,
      consecutiveMissedLessons: seed > 30 ? 1 : 0,
      daysSinceLastLesson: 2 + (seed % 10),
      paymentsMissed: seed > 35 ? 1 : 0, totalPaymentsDue: 2,
      attendanceTrend: seed > 20 ? 'improving' : 'stable'
    })
  };
}

module.exports = { calculateTestReadiness, calculateDropoutRisk, generateDemoPrediction };
