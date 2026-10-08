/**
 * Analytics, Metrics & Zero-Dependency Canvas/SVG Visualizer.
 * Provides:
 * 1. Mastery Breakdown (New, Learning, Reviewing, Mastered).
 * 2. Retention Rate & Accuracy.
 * 3. Daily Streak & Token tracking counters.
 * 4. HTML5 Canvas Donut Chart for Mastery.
 * 5. HTML5 Canvas Bar Chart for SM-2 Quality Score Distribution.
 */

export function calculateMetricsData(words = [], metrics = {}) {
  const totalWords = words.length;
  let newWords = 0;       // repetitions === 0
  let learning = 0;       // repetitions between 1 and 2
  let reviewing = 0;      // repetitions >= 3 && interval < 30
  let mastered = 0;       // interval >= 30

  let totalInterval = 0;
  const scoreCounts = [0, 0, 0, 0, 0, 0]; // grades 0 to 5

  for (const w of words) {
    const reps = w.repetitions || 0;
    const interval = w.interval || 0;
    totalInterval += interval;

    if (reps === 0) {
      newWords++;
    } else if (reps <= 2) {
      learning++;
    } else if (interval < 30) {
      reviewing++;
    } else {
      mastered++;
    }

    if (Array.isArray(w.history)) {
      for (const h of w.history) {
        if (h.quality !== undefined && h.quality >= 0 && h.quality <= 5) {
          scoreCounts[Math.round(h.quality)]++;
        }
      }
    }
  }

  const reviewCount = metrics.reviewCount || 0;
  const correctCount = metrics.correctReviewCount || 0;
  const retentionRate = reviewCount > 0 ? Math.round((correctCount / reviewCount) * 100) : 100;
  const avgInterval = totalWords > 0 ? (totalInterval / totalWords).toFixed(1) : 0;

  return {
    totalWords,
    mastery: {
      newWords,
      learning,
      reviewing,
      mastered
    },
    retentionRate,
    avgInterval,
    scoreCounts,
    streak: metrics.streak || 0,
    tokens: {
      input: metrics.totalInputTokens || 0,
      output: metrics.totalOutputTokens || 0,
      total: metrics.totalTokens || 0,
      costUSD: (metrics.totalCostUSD || 0).toFixed(4)
    }
  };
}

/**
 * Draws a clean, responsive Donut Chart on an HTML5 Canvas.
 */
export function drawMasteryDonut(canvas, masteryData) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 200;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  const data = [
    { label: 'New', value: masteryData.newWords || 0, color: '#94a3b8' },
    { label: 'Learning', value: masteryData.learning || 0, color: '#f59e0b' },
    { label: 'Reviewing', value: masteryData.reviewing || 0, color: '#3b82f6' },
    { label: 'Mastered', value: masteryData.mastered || 0, color: '#10b981' }
  ];

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 20;
  const innerRadius = radius * 0.62;

  if (total === 0) {
    // Empty ring placeholder
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.arc(centerX, centerY, innerRadius, 2 * Math.PI, 0, true);
    ctx.fillStyle = '#334155';
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No words yet', centerX, centerY);
    return;
  }

  let startAngle = -0.5 * Math.PI;

  for (const item of data) {
    if (item.value === 0) continue;
    const sliceAngle = (item.value / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();

    startAngle = endAngle;
  }

  // Center text (Total count)
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${total}`, centerX, centerY - 6);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('WORDS', centerX, centerY + 14);
}

/**
 * Draws a clean Bar Chart on an HTML5 Canvas for Quality Scores (0-5).
 */
export function drawScoreBarChart(canvas, scoreCounts = [0, 0, 0, 0, 0, 0]) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 180;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  const maxVal = Math.max(...scoreCounts, 1);
  const paddingX = 30;
  const paddingBottom = 30;
  const chartHeight = height - paddingBottom - 20;
  const barWidth = (width - paddingX * 2) / 6 - 8;

  const barColors = [
    '#ef4444', // 0: Blackout
    '#f97316', // 1: Incorrect
    '#eab308', // 2: Close
    '#06b6d4', // 3: Pass
    '#3b82f6', // 4: Good
    '#10b981'  // 5: Perfect
  ];

  for (let i = 0; i < 6; i++) {
    const val = scoreCounts[i];
    const x = paddingX + i * (barWidth + 8);
    const barH = (val / maxVal) * chartHeight;
    const y = height - paddingBottom - barH;

    // Draw background track
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x, height - paddingBottom - chartHeight, barWidth, chartHeight);

    // Draw actual bar
    if (barH > 0) {
      ctx.fillStyle = barColors[i];
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
      ctx.fill();
    }

    // Draw value label above bar
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${val}`, x + barWidth / 2, y - 4);

    // Draw X-axis label
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${i}★`, x + barWidth / 2, height - 10);
  }
}
