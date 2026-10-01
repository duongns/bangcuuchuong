const DB_NAME = 'BangCuuChuongDB';
const DB_VERSION = 4;

let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Lỗi khi mở IndexedDB:', event.target.errorCode);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('IndexedDB đã mở thành công');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      db = event.target.result;
      const txn = event.target.transaction;

      if (!db.objectStoreNames.contains('profile')) {
        const profileStore = db.createObjectStore('profile', { keyPath: 'id', autoIncrement: true });
        profileStore.createIndex('name', 'name', { unique: false });
        profileStore.createIndex('level', 'level', { unique: false });
        profileStore.createIndex('xp', 'xp', { unique: false });
      }

      if (!db.objectStoreNames.contains('question')) {
        const questionStore = db.createObjectStore('question', { keyPath: 'id', autoIncrement: true });
        questionStore.createIndex('type', 'type', { unique: false });
        questionStore.createIndex('table', 'table', { unique: false });
        questionStore.createIndex('level', 'level', { unique: false });

        questionStore.transaction.oncomplete = () => {
          const qStore = db.transaction('question', 'readwrite').objectStore('question');
          for (let table = 1; table <= 9; table++) {
            for (let factor = 0; factor <= 10; factor++) {
              qStore.add({ type: 'add', table, factor, level: 0, questionText: `${factor} + ${table} = ?`, answer: table + factor });
              qStore.add({ type: 'sub', table, factor, level: 0, questionText: `${table + factor} - ${table} = ?`, answer: factor });
            }
            for (let factor = 1; factor <= 10; factor++) {
              qStore.add({ type: 'mul', table, factor, level: 0, questionText: `${table} × ${factor} = ?`, answer: table * factor });
              qStore.add({ type: 'div', table, factor, level: 0, questionText: `${table * factor} ÷ ${table} = ?`, answer: factor });
            }
          }
        };
      } else {
        const questionStore = txn.objectStore('question');
        if (!questionStore.indexNames.contains('level')) {
          questionStore.createIndex('level', 'level', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains('answer_history')) {
        const historyStore = db.createObjectStore('answer_history', { keyPath: ['playerId', 'questionId'] });
        historyStore.createIndex('playerId', 'playerId', { unique: false });
        historyStore.createIndex('questionId', 'questionId', { unique: false });
      }

      // v4 không đổi schema object store. Mastery V2 được lưu bằng các trường mới
      // trong từng record answer_history để tương thích dữ liệu cũ.
    };
  });
}

// ── MASTERY V2 HELPERS ──────────────────────────────────────
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isoDay(dateLike) {
  return new Date(dateLike).toISOString().slice(0, 10);
}

function addHoursISO(now, hours) {
  return new Date(now.getTime() + hours * HOUR_MS).toISOString();
}

function normalizeHistoryRecord(record, playerId = null, questionId = null) {
  const r = record || {
    playerId,
    questionId,
    correctCount: 0,
    wrongCount: 0
  };

  r.correctCount = Number(r.correctCount || 0);
  r.wrongCount = Number(r.wrongCount || 0);
  r.lastAskedAt = r.lastAskedAt || null;
  r.lastWrongAt = r.lastWrongAt || null;
  r.lastCorrectAt = r.lastCorrectAt || null;
  r.lastCorrectTimeTaken = Number.isFinite(r.lastCorrectTimeTaken) ? r.lastCorrectTimeTaken : null;
  r.lastTimeTaken = Number.isFinite(r.lastTimeTaken) ? r.lastTimeTaken : null;
  r.avgTimeTaken = Number.isFinite(r.avgTimeTaken) ? r.avgTimeTaken : null;

  // Nếu là record cũ V1 thì suy ra mastery từ công thức cũ một lần để không mất tiến trình.
  if (!Number.isInteger(r.masteryLevel)) {
    r.masteryLevel = computeLegacyMastery(r);
  }

  r.consecutiveCorrect = Number(r.consecutiveCorrect || 0);
  r.consecutiveWrong = Number(r.consecutiveWrong || 0);
  r.successfulReviews = Number(r.successfulReviews || 0);
  r.successfulReviewDays = Array.isArray(r.successfulReviewDays) ? r.successfulReviewDays : [];
  r.currentIntervalHours = Number(r.currentIntervalHours || 0);
  r.nextReviewAt = r.nextReviewAt || null;
  r.lapseCount = Number(r.lapseCount || 0);
  r.recentResults = Array.isArray(r.recentResults) ? r.recentResults.slice(-10) : [];
  r.lastSuccessfulReviewAt = r.lastSuccessfulReviewAt || null;
  r.lastRating = r.lastRating || null;

  return r;
}

function computeLegacyMastery(record) {
  if (!record) return 0;
  const totalAttempts = Number(record.correctCount || 0) + Number(record.wrongCount || 0);
  if (totalAttempts === 0) return 0;

  const accuracy = Number(record.correctCount || 0) / totalAttempts;
  const isLastAnswerWrong = record.lastWrongAt && record.lastAskedAt && record.lastWrongAt === record.lastAskedAt;

  if (accuracy < 0.5 || Number(record.correctCount || 0) === 0 || (isLastAnswerWrong && Number(record.correctCount || 0) < 3)) return 1;

  const t = Number.isFinite(record.lastCorrectTimeTaken) ? record.lastCorrectTimeTaken : 999;
  const avgT = Number.isFinite(record.avgTimeTaken) ? record.avgTimeTaken : 999;
  if (!isLastAnswerWrong && record.correctCount >= 5 && accuracy >= 0.9 && t <= 6 && avgT <= 10) return 5;
  if (!isLastAnswerWrong && record.correctCount >= 4 && accuracy >= 0.85 && t <= 10) return 4;
  if (!isLastAnswerWrong && record.correctCount >= 2 && accuracy >= 0.7 && t <= 15) return 3;
  return 2;
}

function getRecentAccuracy(record) {
  const rr = record.recentResults || [];
  if (!rr.length) {
    const total = record.correctCount + record.wrongCount;
    return total ? record.correctCount / total : 0;
  }
  return rr.filter(x => x.correct).length / rr.length;
}

function getRecentCorrectAverageTime(record, limit = 5) {
  const times = (record.recentResults || [])
    .filter(x => x.correct && Number.isFinite(x.timeTaken))
    .slice(-limit)
    .map(x => x.timeTaken);
  if (!times.length) return 999;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

function classifyAnswer(isCorrect, timeTaken) {
  if (!isCorrect) return 'wrong';
  if (timeTaken <= 4) return 'easy';
  if (timeTaken <= 8) return 'good';
  return 'hard';
}

function isDue(record, now = new Date()) {
  if (!record?.nextReviewAt) return false;
  return now.getTime() >= new Date(record.nextReviewAt).getTime();
}

function updateSuccessfulReview(record, now, wasDue, isCorrect) {
  if (!wasDue || !isCorrect) return;
  record.successfulReviews += 1;
  const day = isoDay(now);
  if (!record.successfulReviewDays.includes(day)) {
    record.successfulReviewDays.push(day);
  }
  record.lastSuccessfulReviewAt = now.toISOString();
}

function evaluateMastery(record, rating, now, wasDue) {
  const recentAccuracy = getRecentAccuracy(record);
  const recentAvg = getRecentCorrectAverageTime(record, 5);
  const level = record.masteryLevel;
  const currentResult = record.recentResults[record.recentResults.length - 1];
  const timeTaken = currentResult?.timeTaken ?? 999;

  if (level === 0) {
    record.masteryLevel = 1;
    return;
  }

  if (rating === 'wrong') {
    if (level >= 3) {
      record.masteryLevel = level - 1;
      record.lapseCount += 1;
    } else if (level === 2 && record.consecutiveWrong >= 2) {
      record.masteryLevel = 1;
    }
    return;
  }

  // Level 1 -> 2: có thể đạt trong cùng buổi, nhưng chưa được lên 3 nếu chưa có review đến hạn.
  if (record.masteryLevel === 1) {
    if (
      record.correctCount >= 2 &&
      record.consecutiveCorrect >= 2 &&
      recentAccuracy >= 0.60 &&
      timeTaken <= 10
    ) {
      record.masteryLevel = 2;
    }
    return;
  }

  // Từ Level 2 trở lên chỉ thăng cấp khi đây là một review thực sự đến hạn.
  if (!wasDue) return;

  if (record.masteryLevel === 2) {
    if (
      record.successfulReviews >= 1 &&
      record.correctCount >= 3 &&
      recentAccuracy >= 0.70 &&
      timeTaken <= 8
    ) {
      record.masteryLevel = 3;
    }
    return;
  }

  if (record.masteryLevel === 3) {
    if (
      record.successfulReviews >= 3 &&
      record.successfulReviewDays.length >= 2 &&
      recentAccuracy >= 0.80 &&
      timeTaken <= 6
    ) {
      record.masteryLevel = 4;
    }
    return;
  }

  if (record.masteryLevel === 4) {
    const intervalLongEnough = record.currentIntervalHours >= 168;
    if (
      record.successfulReviews >= 4 &&
      record.successfulReviewDays.length >= 3 &&
      recentAccuracy >= 0.90 &&
      timeTaken <= 4 &&
      recentAvg <= 6 &&
      intervalLongEnough
    ) {
      record.masteryLevel = 5;
    }
  }
}

function scheduleNextReview(record, rating, now) {
  let hours;
  const level = record.masteryLevel;

  if (rating === 'wrong') {
    if (level <= 1) hours = 0.17;      // ~10 phút
    else if (level === 2) hours = 6;
    else hours = 24;
  } else if (level <= 1) {
    hours = 0.17;
  } else if (level === 2) {
    hours = rating === 'hard' ? 6 : 24;
  } else if (level === 3) {
    hours = rating === 'hard' ? 24 : rating === 'easy' ? 96 : 72;
  } else if (level === 4) {
    hours = rating === 'hard' ? 48 : rating === 'easy' ? 240 : 168;
  } else {
    const base = Math.max(record.currentIntervalHours || 504, 504); // 21 ngày
    if (rating === 'hard') hours = 168;
    else if (rating === 'easy') hours = Math.min(base * 2, 1440);    // cap 60 ngày
    else hours = Math.min(base * 1.5, 1440);
  }

  record.currentIntervalHours = Math.max(hours, 0.17);
  record.nextReviewAt = addHoursISO(now, record.currentIntervalHours);
}

function updateRunningAverage(oldAvg, oldCount, newValue) {
  if (!Number.isFinite(oldAvg) || oldCount <= 0) return newValue;
  return ((oldAvg * oldCount) + newValue) / (oldCount + 1);
}

// ── PROFILE ──────────────────────────────────────────────────
function getProfile() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['profile'], 'readonly');
    const store = transaction.objectStore('profile');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result && request.result.length > 0 ? request.result[0] : null);
    request.onerror = (err) => reject(err);
  });
}

function addProfile(name) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['profile'], 'readwrite');
    const store = transaction.objectStore('profile');
    const request = store.add({ name, level: 1, xp: 0 });
    request.onsuccess = () => resolve();
    request.onerror = (err) => reject(err);
  });
}

// ── QUESTIONS ────────────────────────────────────────────────
function getQuestions(types, tables) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['question'], 'readonly');
    const store = transaction.objectStore('question');
    const request = store.getAll();
    request.onsuccess = () => {
      const allQs = request.result || [];
      resolve(allQs.filter(q => types.includes(q.type) && tables.includes(q.table)));
    };
    request.onerror = (err) => reject(err);
  });
}

function getPlayerHistoryMap(playerId) {
  return new Promise((resolve, reject) => {
    if (!playerId) return resolve({});
    const tx = db.transaction(['answer_history'], 'readonly');
    const store = tx.objectStore('answer_history');
    const req = store.index('playerId').getAll(playerId);
    req.onsuccess = () => {
      const map = {};
      for (const raw of req.result || []) {
        const h = normalizeHistoryRecord(raw);
        map[h.questionId] = h;
      }
      resolve(map);
    };
    req.onerror = reject;
  });
}

async function getQuestionsWithMastery(playerId, types, tables) {
  const [questions, historyMap] = await Promise.all([
    getQuestions(types, tables),
    getPlayerHistoryMap(playerId)
  ]);

  return questions.map(q => {
    const history = historyMap[q.id] || null;
    return {
      ...q,
      masteryLevel: history ? history.masteryLevel : 0,
      mastery: history
    };
  });
}

// ── ANSWER HISTORY V2 ────────────────────────────────────────
function recordAnswerV2(playerId, questionId, isCorrect, timeTaken, options = {}) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['answer_history'], 'readwrite');
    const store = transaction.objectStore('answer_history');
    const request = store.get([playerId, questionId]);

    let resultPayload = null;

    request.onsuccess = () => {
      const now = new Date();
      const nowIso = now.toISOString();
      const safeTime = Math.max(0, Math.min(Number(timeTaken || 0), 10));
      const timedOut = options.timedOut === true;
      const rating = classifyAnswer(isCorrect, safeTime);

      let record = normalizeHistoryRecord(request.result, playerId, questionId);
      const wasDue = isDue(record, now);
      const oldAttemptCount = record.correctCount + record.wrongCount;

      record.lastAskedAt = nowIso;
      record.lastTimeTaken = safeTime;
      record.lastRating = rating;

      if (isCorrect) {
        record.correctCount += 1;
        record.consecutiveCorrect += 1;
        record.consecutiveWrong = 0;
        record.lastCorrectAt = nowIso;
        record.lastCorrectTimeTaken = safeTime;
      } else {
        record.wrongCount += 1;
        record.consecutiveWrong += 1;
        record.consecutiveCorrect = 0;
        record.lastWrongAt = nowIso;
      }

      record.avgTimeTaken = updateRunningAverage(record.avgTimeTaken, oldAttemptCount, safeTime);
      record.recentResults.push({
        correct: !!isCorrect,
        timeTaken: safeTime,
        timedOut,
        at: nowIso
      });
      record.recentResults = record.recentResults.slice(-10);

      updateSuccessfulReview(record, now, wasDue, isCorrect);
      evaluateMastery(record, rating, now, wasDue);
      scheduleNextReview(record, rating, now);

      store.put(record);
      resultPayload = {
        record,
        rating,
        wasDue,
        masteryLevel: record.masteryLevel,
        nextReviewAt: record.nextReviewAt
      };
    };

    transaction.oncomplete = () => resolve(resultPayload);
    transaction.onerror = (err) => reject(err);
    transaction.onabort = (err) => reject(err);
  });
}

// Backward-compatible alias trong trường hợp code cũ còn gọi recordAnswer().
function recordAnswer(playerId, questionId, isCorrect, timeTaken) {
  return recordAnswerV2(playerId, questionId, isCorrect, timeTaken, { timedOut: !isCorrect && timeTaken >= 10 });
}

// ── QUESTION PRIORITY / SCHEDULER ────────────────────────────
function getDueScore(record, now = new Date()) {
  if (!record?.nextReviewAt) return 0;
  const dueAt = new Date(record.nextReviewAt).getTime();
  const delta = now.getTime() - dueAt;
  if (delta < 0) return 0;
  if (delta > 7 * DAY_MS) return 100;
  if (delta > 3 * DAY_MS) return 80;
  if (delta > DAY_MS) return 60;
  return 50;
}

function getMasteryScore(level) {
  return [35, 45, 35, 20, 10, 5][level] ?? 0;
}

function getErrorScore(record) {
  if (!record) return 0;
  const recent = (record.recentResults || []).slice(-5);
  const wrongCount = recent.filter(x => !x.correct).length;
  const table = [0, 15, 30, 50, 70, 80];
  let score = table[wrongCount] || 0;
  const last = recent[recent.length - 1];
  if (last && !last.correct) score += 40;
  return score;
}

function getSlowScore(record) {
  if (!record) return 0;
  const avg = getRecentCorrectAverageTime(record, 3);
  if (avg > 8 && avg < 999) return 30;
  if (avg > 6) return 20;
  if (avg > 4) return 10;
  return 0;
}

function getRecentPenalty(questionId, recentQuestionIds = []) {
  const len = recentQuestionIds.length;
  for (let i = len - 1; i >= 0; i--) {
    if (recentQuestionIds[i] !== questionId) continue;
    const distance = len - i;
    if (distance <= 1) return 100;
    if (distance <= 2) return 80;
    if (distance <= 4) return 50;
    if (distance <= 8) return 15;
  }
  return 0;
}

function calculatePriority(question, context = {}) {
  const record = question.mastery;
  const level = question.masteryLevel || 0;
  const now = context.now || new Date();

  const dueScore = getDueScore(record, now);
  const masteryScore = getMasteryScore(level);
  const errorScore = getErrorScore(record);
  const slowScore = getSlowScore(record);
  const lapseScore = Math.min((record?.lapseCount || 0) * 5, 30);
  const newQuestionScore = level === 0 ? 20 : 0;
  const recentPenalty = getRecentPenalty(question.id, context.recentQuestionIds || []);

  let priority = dueScore + masteryScore + errorScore + slowScore + lapseScore + newQuestionScore - recentPenalty;

  // Nếu đã vượt quota câu mới thì gần như loại câu Level 0 khỏi pool, trừ khi không còn lựa chọn khác.
  if (level === 0 && Number.isFinite(context.newQuestionQuotaRemaining) && context.newQuestionQuotaRemaining <= 0) {
    priority -= 1000;
  }

  return Math.max(priority, 1);
}

function weightedRandom(items, weightFn) {
  if (!items.length) return null;
  const weighted = items.map(item => ({ item, weight: Math.max(0.01, weightFn(item)) }));
  const total = weighted.reduce((sum, x) => sum + x.weight, 0);
  let roll = Math.random() * total;
  for (const x of weighted) {
    roll -= x.weight;
    if (roll <= 0) return x.item;
  }
  return weighted[weighted.length - 1].item;
}

async function selectNextQuestion(playerId, types, tables, context = {}) {
  const questions = await getQuestionsWithMastery(playerId, types, tables);
  if (!questions.length) return null;

  const now = new Date();
  const ctx = { ...context, now };

  // 1) Overdue / due questions được ưu tiên thành một pool riêng.
  const duePool = questions.filter(q => q.mastery?.nextReviewAt && isDue(q.mastery, now));
  const candidatePool = duePool.length ? duePool : questions;

  // 2) Tránh lấy đúng câu vừa hỏi nếu còn lựa chọn khác.
  const recent = context.recentQuestionIds || [];
  const lastId = recent[recent.length - 1];
  let filtered = candidatePool.filter(q => q.id !== lastId);
  if (!filtered.length) filtered = candidatePool;

  return weightedRandom(filtered, q => calculatePriority(q, ctx));
}

// ── REPORTING / COMPATIBILITY ────────────────────────────────
async function updateQuestionLevels(playerId) {
  // V2 không còn dùng question.level làm nguồn sự thật. Hàm này chỉ giữ lại để
  // index.html cũ không lỗi nếu còn gọi, và đồng bộ cache level cho tương thích.
  const historyMap = await getPlayerHistoryMap(playerId);
  return new Promise((resolve, reject) => {
    const txQ = db.transaction(['question'], 'readwrite');
    const store = txQ.objectStore('question');
    const req = store.getAll();
    req.onsuccess = () => {
      for (const q of req.result || []) {
        const level = historyMap[q.id]?.masteryLevel || 0;
        if (q.level !== level) {
          q.level = level;
          store.put(q);
        }
      }
    };
    txQ.oncomplete = () => resolve();
    txQ.onerror = reject;
  });
}

const dbReady = initDB().then(() => {
  console.log('Cơ sở dữ liệu IndexedDB (BangCuuChuongDB) Mastery V2 đã sẵn sàng.');
}).catch(err => {
  console.error('Lỗi khởi tạo DB:', err);
});
