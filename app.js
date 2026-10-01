// ── STATE ──────────────────────────────────────────────
    const OPT_COLORS = [
      'linear-gradient(135deg,#FF6B6B,#FF8E53)',
      'linear-gradient(135deg,#4D96FF,#CC5DE8)',
      'linear-gradient(135deg,#6BCB77,#20C997)',
      'linear-gradient(135deg,#FFD93D,#FF922B)'
    ];

    let score = 0, streak = 0;
    let questionTimer = null, questionTimeLeft = 10;
    let sessionTimer = null, sessionTimeLeft = 0;
    let gameDurationMinutes = 5;
    let gameTypes = [], gameTables = [], gameStartTime = null;
    let currentAnswer = 0, answered = false;
    let lastQuestion = null;
    let recoveryQueue = [];
    let recentQuestionIds = [];
    let sessionNewQuestionIds = new Set();
    let currentRecoveryItem = null;
    let relatedQuestionQueue = [];
    let queuedFactFamilyKeys = new Set();
    const WRONG_MEMORY_PAUSE_MS = 8000;
    let currentQuestionCorrectText = '';
    let currentPlayerId = null;
    let questionDisplayedAt = null;
    let practiceMode = 'normal';

    // ── SETUP ──────────────────────────────────────────────
    (function buildNumChips() {
      const g = document.getElementById('numChips');
      for (let i = 2; i <= 9; i++) {
        const d = document.createElement('div');
        d.className = 'chip chip-num selected';
        d.dataset.num = i;
        d.innerHTML = `<span>× ${i}</span>`;
        d.onclick = function () { toggleChip(this, 'num'); };
        g.appendChild(d);
      }
    })();

    function toggleChip(el, group) {
      el.classList.toggle('selected');
    }
    function toggleDuration(el) {
      document.querySelectorAll('#durationChips .chip').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
    }
    function selectAllNums() {
      document.querySelectorAll('#numChips .chip').forEach(c => c.classList.add('selected'));
    }
    function clearAllNums() {
      document.querySelectorAll('#numChips .chip').forEach(c => c.classList.remove('selected'));
    }

    function openSetup() {
      document.getElementById('resultOverlay').classList.remove('open');
      document.getElementById('setupOverlay').classList.add('open');
    }
    function closeSetup() {
      document.getElementById('setupOverlay').classList.remove('open');
    }

    // ── PAUSE / RESUME ─────────────────────────────────────
    let isPaused = false;

    function pauseGame() {
      if (isPaused) return;
      isPaused = true;

      // Dừng cả 2 đồng hồ
      clearInterval(questionTimer);
      clearInterval(sessionTimer);

      // Dừng speech synthesis nếu đang đọc
      if (window.speechSynthesis) window.speechSynthesis.pause();

      // Điền thông tin vào popup
      document.getElementById('pauseScoreNum').textContent = score;
      document.getElementById('pauseStreakLabel').textContent = `🔥 Streak: ${streak}`;

      // Mở overlay
      document.getElementById('pauseOverlay').classList.add('open');
    }

    function resumeGame() {
      if (!isPaused) return;
      isPaused = false;

      // Đóng overlay
      document.getElementById('pauseOverlay').classList.remove('open');

      // Tiếp tục speech synthesis
      if (window.speechSynthesis) window.speechSynthesis.resume();

      // Khởi động lại đồng hồ câu hỏi với thời gian còn lại
      questionTimer = setInterval(() => {
        questionTimeLeft--;
        document.getElementById('qTimerDisplay').textContent = questionTimeLeft;
        if (questionTimeLeft <= 0) {
          clearInterval(questionTimer);
          choose(null, null);
        }
      }, 1000);

      // Khởi động lại session timer với thời gian còn lại
      sessionTimer = setInterval(() => {
        sessionTimeLeft--;
        updateSessionDisplay();
        if (sessionTimeLeft <= 0) {
          clearInterval(sessionTimer);
          endGame(false, false, true);
        }
      }, 1000);
    }

    function confirmEndGame() {
      isPaused = false;
      document.getElementById('pauseOverlay').classList.remove('open');
      endGame();
    }


    function getLeaderboard() {
      try { return JSON.parse(localStorage.getItem('ccLeaderboard') || '[]'); }
      catch (e) { return []; }
    }
    function saveLeaderboard(lb) {
      localStorage.setItem('ccLeaderboard', JSON.stringify(lb));
    }
    function addRecord(record) {
      const lb = getLeaderboard();
      lb.push(record);
      lb.sort((a, b) => b.score - a.score);
      saveLeaderboard(lb.slice(0, 20));
    }

    function masteryLegendHtml() {
      return `<div class="history-mastery-legend">
        <span><i class="legend-dot m0"></i>L0 Chưa học</span><span><i class="legend-dot m1"></i>L1 Làm quen</span>
        <span><i class="legend-dot m2"></i>L2 Đang nhớ</span><span><i class="legend-dot m3"></i>L3 Đã nhớ</span>
        <span><i class="legend-dot m4"></i>L4 Thành thạo</span><span><i class="legend-dot m5"></i>L5 Phản xạ</span>
      </div>`;
    }

    function renderMasterySnapshot(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.facts) || !snapshot.facts.length) {
        return '<div class="lb-no-snapshot">Bản đồ Mastery được lưu từ các lượt chơi sau bản cập nhật này.</div>';
      }
      const typeNames = { mul:'✖️ Phép nhân', div:'➗ Phép chia', add:'➕ Phép cộng', sub:'➖ Phép trừ' };
      const symbols = { mul:'×', div:'÷', add:'+', sub:'−' };
      const groups = {};
      snapshot.facts.forEach(f => {
        const key = `${f.type}:${f.table}`;
        (groups[key] ||= []).push(f);
      });
      const byType = {};
      Object.entries(groups).forEach(([key, facts]) => {
        const [type, table] = key.split(':');
        (byType[type] ||= []).push({ table:+table, facts:facts.sort((a,b)=>a.factor-b.factor) });
      });
      const html = Object.entries(byType).map(([type, rows]) => {
        rows.sort((a,b)=>a.table-b.table);
        const rowHtml = rows.map(row => {
          const facts = row.facts.map(f => {
            let text;
            if (type === 'mul') text = `${f.table}×${f.factor}`;
            else if (type === 'div') text = `${f.table*f.factor}÷${f.table}`;
            else if (type === 'add') text = `${f.factor}+${f.table}`;
            else text = `${f.factor+f.table}−${f.table}`;
            return `<span class="history-fact m${f.masteryLevel}" title="${text} = ${f.answer} · Level ${f.masteryLevel}">${text}</span>`;
          }).join('');
          return `<div class="history-table-row"><div class="history-table-label">${symbols[type]} ${row.table}</div><div class="history-facts">${facts}</div></div>`;
        }).join('');
        return `<div class="history-op-group"><div class="history-op-title">${typeNames[type] || type}</div>${rowHtml}</div>`;
      }).join('');
      return masteryLegendHtml() + html;
    }

    function renderLeaderboard() {
      const lb = getLeaderboard();
      const el = document.getElementById('leaderboard');
      if (!lb.length) { el.innerHTML = '<div class="lb-empty">Chưa có thành tích nào. Hãy chơi ngay! 🎮</div>'; return; }
      const rankIcons = ['🥇', '🥈', '🥉'];
      const rankCls = ['gold', 'silver', 'bronze'];
      el.innerHTML = lb.map((r, i) => {
        const rank = i < 3 ? `<span class="lb-rank ${rankCls[i]}">${rankIcons[i]}</span>`
          : `<span class="lb-rank rest">${i + 1}</span>`;
        const types = (r.types || []).join('+');
        const tables = (r.tables || []).join(',');
        const d = new Date(r.time);
        const timeStr = d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const playerLabel = r.playerName ? `<strong>${r.playerName}</strong> — ` : '';
        const mapHtml = renderMasterySnapshot(r.masterySnapshot);
        return `<div class="lb-entry">
          <div class="lb-item">
            ${rank}
            <div class="lb-info">
              <div style="font-weight:700;font-size:1rem;">${playerLabel}${types} | Bảng ${tables}</div>
              <div class="lb-meta">${timeStr}${r.duration ? ` · ${r.duration} phút` : ''}</div>
            </div>
            <div class="lb-score">${r.score}</div>
          </div>
          <details class="lb-mastery-details"><summary>🧠 Bản đồ thuộc phép tính tại lượt này</summary><div class="lb-mastery-panel">${mapHtml}</div></details>
        </div>`;
      }).join('');
    }

    function setAllGameFilters() {
      document.querySelectorAll('.chip-mul,.chip-div,.chip-add,.chip-sub').forEach(c => c.classList.add('selected'));
      document.querySelectorAll('#numChips .chip').forEach(c => c.classList.add('selected'));
      document.querySelectorAll('#durationChips .chip').forEach(c => c.classList.remove('selected'));
      const five = document.querySelector('#durationChips .chip[data-duration="5"]');
      if (five) five.classList.add('selected');
    }

    async function startSmartPractice(mode) {
      if (!currentPlayerId) return;
      setAllGameFilters();
      await startGame(mode);
    }

    function typeSymbol(type) {
      return type === 'mul' ? '×' : type === 'div' ? '÷' : type === 'add' ? '+' : type === 'sub' ? '−' : '?';
    }

    async function renderLearningDashboard() {
      const el = document.getElementById('learningDashboard');
      if (!el) return;
      if (!currentPlayerId) {
        el.innerHTML = '<div class="dashboard-empty">Nhập tên để bắt đầu theo dõi tiến trình học nhé.</div>';
        return;
      }

      try {
        const stats = await getLearningDashboard(currentPlayerId);
        const weakHtml = stats.weakQuestions.length
          ? stats.weakQuestions.slice(0, 6).map(q => `<span class="weak-chip">${q.table} ${typeSymbol(q.type)} ${q.factor} · L${q.masteryLevel}</span>`).join('')
          : '<span style="color:#888;font-size:.82rem;">Chưa có điểm yếu rõ ràng. Cứ học tiếp nhé! 🎉</span>';

        el.innerHTML = `
          <div class="dashboard-head">
            <div><h2>🧠 Tiến trình học</h2><div class="dashboard-sub">Mastery V2 · học đúng lúc, ôn đúng chỗ</div></div>
          </div>
          <div class="smart-actions">
            <button class="smart-action action-review" onclick="startSmartPractice('review')"><strong>📅 Ôn hôm nay (${stats.dueCount})</strong><span>Ưu tiên các phép tính đã đến hạn ôn</span></button>
            <button class="smart-action action-weak" onclick="startSmartPractice('weak')"><strong>🎯 Luyện điểm yếu (${stats.weakCount})</strong><span>Tập trung câu hay sai, còn chậm và Level thấp</span></button>
          </div>
          <div class="dashboard-stats">
            <div class="dash-stat"><div class="num" style="color:#4D96FF">${stats.dueCount}</div><div class="label">CẦN ÔN</div></div>
            <div class="dash-stat"><div class="num" style="color:#6BCB77">${stats.masteredCount}</div><div class="label">LEVEL 4–5</div></div>
            <div class="dash-stat"><div class="num" style="color:#FF922B">${stats.overallMasteryPercent}%</div><div class="label">MASTERY</div></div>
          </div>
          <div class="weak-list"><div class="weak-list-title">🔎 Cần chú ý nhất</div><div class="weak-chips">${weakHtml}</div></div>
        `;
      } catch (err) {
        console.error('Không thể tải learning dashboard:', err);
        el.innerHTML = '<div class="dashboard-empty">Chưa thể tải tiến trình học.</div>';
      }
    }

    async function startGame(mode = 'normal') {
      practiceMode = mode;
      // collect types
      const typeChips = [...document.querySelectorAll('.chip-mul,.chip-div,.chip-add,.chip-sub')];
      gameTypes = typeChips.filter(c => c.classList.contains('selected')).map(c => c.dataset.type);
      if (!gameTypes.length) { alert('Vui lòng chọn ít nhất một loại phép tính!'); return; }

      // collect tables
      const numChips = [...document.querySelectorAll('#numChips .chip')];
      gameTables = numChips.filter(c => c.classList.contains('selected')).map(c => +c.dataset.num);
      if (!gameTables.length) { alert('Vui lòng chọn ít nhất một bảng tính!'); return; }

      // collect duration
      const selDuration = document.querySelector('#durationChips .chip.selected');
      gameDurationMinutes = selDuration ? +selDuration.dataset.duration : 5;

      closeSetup();
      score = 0; streak = 0;
      lastQuestion = null;
      recoveryQueue = [];
      relatedQuestionQueue = [];
      queuedFactFamilyKeys = new Set();
      recentQuestionIds = [];
      sessionNewQuestionIds = new Set();
      currentRecoveryItem = null;
      gameStartTime = new Date();
      document.getElementById('scoreDisplay').textContent = 0;
      document.getElementById('streakDisplay').textContent = 0;
      document.getElementById('feedbackBanner').style.display = 'none';

      // Start session countdown
      clearInterval(sessionTimer);
      sessionTimeLeft = gameDurationMinutes * 60;
      updateSessionDisplay();
      sessionTimer = setInterval(() => {
        sessionTimeLeft--;
        updateSessionDisplay();
        if (sessionTimeLeft <= 0) {
          clearInterval(sessionTimer);
          endGame(false, false, true);
        }
      }, 1000);

      showScreen('gameScreen');
      nextQuestion();
    }

    function updateSessionDisplay() {
      const m = String(Math.floor(sessionTimeLeft / 60)).padStart(2, '0');
      const s = String(sessionTimeLeft % 60).padStart(2, '0');
      document.getElementById('sessionTimerDisplay').textContent = `${m}:${s}`;
      // Flash red when < 60s
      const badge = document.getElementById('sessionTimerBadge');
      if (sessionTimeLeft <= 60) {
        badge.style.background = 'linear-gradient(135deg, #FF6B6B, #FF922B)';
      } else {
        badge.style.background = 'linear-gradient(135deg, #20C997, #4D96FF)';
      }
    }

    // ── GAME / MASTERY V2 SCHEDULER ─────────────────────────
    function getSessionNewQuestionQuota() {
      if (gameDurationMinutes <= 5) return 8;
      if (gameDurationMinutes <= 10) return 15;
      return 20;
    }

    function decrementRecoveryCounters() {
      recoveryQueue.forEach(item => {
        if (item.stage < 3 && item.dueAfterQuestions > 0) item.dueAfterQuestions--;
      });
    }

    function queueRecovery(question, stage = 1) {
      // Xóa lịch recovery cũ của cùng câu để tránh trùng.
      recoveryQueue = recoveryQueue.filter(item => item.question.id !== question.id);
      recoveryQueue.push({
        question: { ...question },
        stage,
        dueAfterQuestions: stage === 1 ? 2 : stage === 2 ? 5 : 999
      });
    }

    function pickDueRecoveryQuestion() {
      // Stage 1/2: hỏi khi đủ số câu cách quãng.
      let idx = recoveryQueue.findIndex(item => item.stage < 3 && item.dueAfterQuestions <= 0);

      // Stage 3: final recall trong ~90 giây cuối buổi.
      if (idx < 0 && sessionTimeLeft <= 90) {
        idx = recoveryQueue.findIndex(item => item.stage === 3);
      }

      if (idx < 0) return null;
      return recoveryQueue.splice(idx, 1)[0];
    }

    // ── FACT FAMILY / RELATED OPERATIONS ───────────────────────
    // Một fact family giúp trẻ gặp lại cùng quan hệ số dưới các dạng thuận/nghịch:
    // a+b=c ↔ b+a=c ↔ c-a=b ↔ c-b=a; a×b=c ↔ b×a=c ↔ c÷a=b ↔ c÷b=a.
    function relatedDescriptors(q) {
      const a = Number(q.factor);
      const b = Number(q.table);
      if (q.type === 'add' || q.type === 'sub') {
        return [
          { type: 'add', table: b, factor: a },
          { type: 'add', table: a, factor: b },
          { type: 'sub', table: a, factor: b },
          { type: 'sub', table: b, factor: a }
        ];
      }
      return [
        { type: 'mul', table: b, factor: a },
        { type: 'mul', table: a, factor: b },
        { type: 'div', table: a, factor: b },
        { type: 'div', table: b, factor: a }
      ];
    }

    async function queueRelatedQuestions(sourceQuestion) {
      if (!sourceQuestion) return;
      const x = Number(sourceQuestion.factor), y = Number(sourceQuestion.table);
      const familyKind = (sourceQuestion.type === 'add' || sourceQuestion.type === 'sub') ? 'addsub' : 'muldiv';
      const familyKey = `${familyKind}:${Math.min(x, y)}:${Math.max(x, y)}`;
      if (queuedFactFamilyKeys.has(familyKey)) return;
      queuedFactFamilyKeys.add(familyKey);
      const descriptors = relatedDescriptors(sourceQuestion);
      const familyTypes = (sourceQuestion.type === 'add' || sourceQuestion.type === 'sub')
        ? ['add', 'sub'] : ['mul', 'div'];
      // Cho phép phép toán nghịch đảo xuất hiện trong cùng buổi học; chỉ dùng các bảng
      // mà trẻ đã chọn để không mở rộng phạm vi số ngoài ý muốn.
      const candidates = await getQuestionsWithMastery(currentPlayerId, familyTypes, gameTables);
      const sourceId = sourceQuestion.id;
      const matches = candidates.filter(q => q.id !== sourceId && descriptors.some(d =>
        q.type === d.type && Number(q.table) === d.table && Number(q.factor) === d.factor
      ));
      // Không chèn trùng và không hỏi ngay lập tức: câu liên quan sẽ được ưu tiên sau
      // ít nhất 1 câu khác, giúp retrieval thay vì lặp máy móc.
      for (const q of matches) {
        if (relatedQuestionQueue.some(x => x.question.id === q.id)) continue;
        relatedQuestionQueue.push({ question: { ...q }, dueAfterQuestions: 1 });
      }
    }

    function decrementRelatedCounters() {
      relatedQuestionQueue.forEach(item => {
        if (item.dueAfterQuestions > 0) item.dueAfterQuestions--;
      });
    }

    function pickRelatedQuestion() {
      const idx = relatedQuestionQueue.findIndex(item => item.dueAfterQuestions <= 0 &&
        !recentQuestionIds.slice(-1).includes(item.question.id));
      if (idx < 0) return null;
      return relatedQuestionQueue.splice(idx, 1)[0].question;
    }

    async function nextQuestion() {
      answered = false;
      document.getElementById('feedbackBanner').style.display = 'none';

      clearInterval(questionTimer);
      questionTimeLeft = 10;
      document.getElementById('qTimerDisplay').textContent = questionTimeLeft;
      questionTimer = setInterval(() => {
        questionTimeLeft--;
        document.getElementById('qTimerDisplay').textContent = questionTimeLeft;
        if (questionTimeLeft <= 0) {
          clearInterval(questionTimer);
          choose(null, null);
        }
      }, 1000);

      // 1) Recovery queue luôn có quyền ưu tiên cao nhất khi đến lượt.
      currentRecoveryItem = pickDueRecoveryQuestion();
      let q = currentRecoveryItem ? currentRecoveryItem.question : null;

      // 2) Sau recovery, ưu tiên một phép tính cùng fact family đã đến lượt.
      if (!q) q = pickRelatedQuestion();

      // 3) Nếu không có recovery/fact family, Mastery V2 chọn theo Priority Score.
      if (!q) {
        const quota = getSessionNewQuestionQuota();
        q = await selectNextQuestion(currentPlayerId, gameTypes, gameTables, {
          recentQuestionIds,
          newQuestionQuotaRemaining: quota - sessionNewQuestionIds.size,
          mode: practiceMode
        });
      }

      if (!q) {
        endGame(false, false, true);
        return;
      }

      lastQuestion = q;
      if (!currentRecoveryItem) await queueRelatedQuestions(q);

      // Theo dõi số câu mới đã giới thiệu trong session để không nhồi quá nhiều kiến thức mới.
      if ((q.masteryLevel || 0) === 0) sessionNewQuestionIds.add(q.id);

      recentQuestionIds.push(q.id);
      recentQuestionIds = recentQuestionIds.slice(-8);

      const { type, table, factor } = q;
      let eqHTML = '', answer = 0, typeLabel = '', questionText = '';
      if (type === 'mul') {
        answer = table * factor;
        typeLabel = '✖️ Phép nhân';
        eqHTML = `${table} × ${factor} = <span class="q-blank">?</span>`;
        questionText = `${table} nhân ${factor} bằng mấy`;
        currentQuestionCorrectText = `${table} nhân ${factor} bằng ${answer}`;
      } else if (type === 'div') {
        answer = factor;
        typeLabel = '➗ Phép chia';
        eqHTML = `${table * factor} ÷ ${table} = <span class="q-blank">?</span>`;
        questionText = `${table * factor} chia ${table} bằng mấy`;
        currentQuestionCorrectText = `${table * factor} chia ${table} bằng ${answer}`;
      } else if (type === 'add') {
        answer = table + factor;
        typeLabel = '➕ Phép cộng';
        eqHTML = `${factor} + ${table} = <span class="q-blank">?</span>`;
        questionText = `${factor} cộng ${table} bằng mấy`;
        currentQuestionCorrectText = `${factor} cộng ${table} bằng ${answer}`;
      } else if (type === 'sub') {
        answer = factor;
        typeLabel = '➖ Phép trừ';
        eqHTML = `${factor + table} − ${table} = <span class="q-blank">?</span>`;
        questionText = `${factor + table} trừ ${table} bằng mấy`;
        currentQuestionCorrectText = `${factor + table} trừ ${table} bằng ${answer}`;
      }

      currentAnswer = answer;
      document.getElementById('qTypeLabel').textContent = typeLabel;
      document.getElementById('qEquation').innerHTML = eqHTML;
      speakVietnamese(questionText, 0);

      // Phase 1 vẫn giữ 4 đáp án như giao diện cũ. Phase sau có thể nâng lên distractor thông minh / nhập đáp án.
      const pos = Math.floor(Math.random() * 4);
      const start = Math.max(0, answer - pos);
      const opts = [];
      for (let i = 0; i < 4; i++) opts.push(start + i);
      if (!opts.includes(answer)) opts[pos] = answer;
      const shuffled = [...opts].sort(() => Math.random() - .5);

      const grid = document.getElementById('optionsGrid');
      grid.innerHTML = '';
      grid.style.gridTemplateColumns = '1fr 1fr';
      shuffled.forEach((val, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.style.background = OPT_COLORS[i % 4];
        btn.innerHTML = `<span style="font-size:2.2rem">${val}</span>`;
        btn.onclick = () => choose(btn, val);
        grid.appendChild(btn);
      });
      questionDisplayedAt = Date.now();
    }

    async function choose(btn, val) {
      if (answered) return;
      answered = true;
      clearInterval(questionTimer);

      const isTimeOut = (val === null);
      const timeTaken = isTimeOut ? 10 : Math.min((Date.now() - questionDisplayedAt) / 1000, 10);
      const isCorrect = !isTimeOut && (val === currentAnswer);

      let masteryResult = null;
      if (currentPlayerId && lastQuestion && lastQuestion.id) {
        masteryResult = await recordAnswerV2(
          currentPlayerId,
          lastQuestion.id,
          isCorrect,
          timeTaken,
          { timedOut: isTimeOut }
        );
      }

      const banner = document.getElementById('feedbackBanner');
      banner.style.display = 'block';
      document.querySelectorAll('.option-btn').forEach(b => b.style.pointerEvents = 'none');

      if (isCorrect) {
        score++;
        streak++;
        if (btn) btn.classList.add('correct');
        banner.className = 'feedback-banner correct';
        const ratingIcon = masteryResult?.rating === 'easy' ? '⚡' : masteryResult?.rating === 'good' ? '👍' : '🐢';
        banner.textContent = `✅ Chính xác! +1 điểm ${ratingIcon}`;
        spawnConfetti();
        playCorrectSound();
      } else {
        score--;
        if (score < 0) score = 0;
        streak = 0;
        if (btn) btn.classList.add('wrong');
        document.querySelectorAll('.option-btn').forEach(b => {
          if (+b.querySelector('span').textContent === currentAnswer)
            b.style.outline = '4px solid #6BCB77';
        });
        banner.className = 'feedback-banner wrong memory-reminder';
        banner.innerHTML = `🧠 <strong>${isTimeOut ? 'Hết giờ!' : 'Sai rồi!'}</strong><br>Hãy nhắc lại và ghi nhớ:<br><span class="memory-equation">${currentQuestionCorrectText}.</span>`;
        // Trong pha ghi nhớ, thay dấu ? bằng đáp án đúng và giữ nguyên phép tính trên màn hình.
        document.getElementById('qEquation').innerHTML = document.getElementById('qEquation').innerHTML
          .replace(/<span class="q-blank">\?<\/span>/, `<span class="q-blank memory-answer">${currentAnswer}</span>`);
        if (audioCtx.state === 'suspended') audioCtx.resume();
        // Dừng đồng hồ phiên trong toàn bộ pha sửa sai + ghi nhớ.
        // Trẻ sẽ được nghe hết lời nhắc, SAU ĐÓ mới có đủ 8 giây để nhắc lại phép tính.
        clearInterval(sessionTimer);
      }

      // Mỗi câu hoàn tất làm các recovery đang chờ tiến thêm một bước.
      decrementRecoveryCounters();
      decrementRelatedCounters();

      // Cập nhật chuỗi recovery của chính câu vừa làm.
      if (currentRecoveryItem) {
        if (isCorrect) {
          if (currentRecoveryItem.stage === 1) {
            queueRecovery(lastQuestion, 2);       // đúng lần 1 → hỏi lại sau 5 câu
          } else if (currentRecoveryItem.stage === 2) {
            queueRecovery(lastQuestion, 3);       // đúng lần 2 → final recall cuối buổi
          }
          // Stage 3 đúng: hoàn tất recovery trong session, không xếp lại.
        } else {
          queueRecovery(lastQuestion, 1);         // sai ở bất kỳ stage nào → quay về đầu
        }
      } else if (!isCorrect) {
        queueRecovery(lastQuestion, 1);
      }
      currentRecoveryItem = null;

      document.getElementById('scoreDisplay').textContent = score;
      document.getElementById('streakDisplay').textContent = streak;

      if (sessionTimeLeft > 0) {
        if (isCorrect) {
          setTimeout(() => { nextQuestion(); }, 2500);
        } else {
          // Pha ghi nhớ: 1) đọc hết lời nhắc; 2) giữ phép tính đúng thêm đủ 8 giây;
          // 3) mới khởi động lại đồng hồ phiên và chuyển câu.
          await runWrongMemoryPhase(isTimeOut, banner);
          if (sessionTimeLeft > 0 && !isPaused) {
            restartSessionTimer();
            nextQuestion();
          }
        }
      }
    }

    function restartSessionTimer() {
      clearInterval(sessionTimer);
      sessionTimer = setInterval(() => {
        sessionTimeLeft--;
        updateSessionDisplay();
        if (sessionTimeLeft <= 0) {
          clearInterval(sessionTimer);
          endGame(false, false, true);
        }
      }, 1000);
    }

    function speakVietnameseAndWait(text, delay = 0, cancelPrev = true) {
      return new Promise(resolve => {
        if (!window.speechSynthesis) {
          setTimeout(resolve, delay);
          return;
        }
        clearTimeout(speakTimeout);
        if (cancelPrev) window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'vi-VN';
        if (viVoice) utter.voice = viVoice;
        utter.rate = 1.05;
        utter.pitch = 1.1;
        utter.volume = 1;
        let finished = false;
        const done = () => { if (!finished) { finished = true; resolve(); } };
        utter.onend = done;
        utter.onerror = done;
        const start = () => {
          try { window.speechSynthesis.speak(utter); }
          catch (_) { done(); }
        };
        if (delay > 0) speakTimeout = setTimeout(start, delay); else start();
        // Fallback phòng trường hợp một số WebView không phát sự kiện onend/onerror.
        setTimeout(done, 12000);
      });
    }

    async function runWrongMemoryPhase(isTimeOut, banner) {
      const speech = `${isTimeOut ? 'Hết giờ. ' : 'Sai rồi. '}Hãy nhắc lại và ghi nhớ. ${currentQuestionCorrectText}.`;
      await speakVietnameseAndWait(speech, 250, true);

      // 8 giây này bắt đầu SAU KHI giọng đọc đã kết thúc.
      const totalSeconds = Math.round(WRONG_MEMORY_PAUSE_MS / 1000);
      for (let seconds = totalSeconds; seconds > 0; seconds--) {
        banner.innerHTML = `🧠 <strong>Hãy nhắc lại và ghi nhớ</strong><br><span class="memory-equation">${currentQuestionCorrectText}.</span><br><small>⏳ Ghi nhớ thêm ${seconds} giây</small>`;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    async function endGame(isGameOver = false, isVictory = false, isTimeUp = false) {
      clearInterval(questionTimer);
      clearInterval(sessionTimer);
      const greetEl = document.getElementById('greetingText');
      const greetText = greetEl ? greetEl.textContent : '';
      const playerName = greetText.replace('Chào mừng ', '').replace(' trở lại!', '').trim() || null;

      // Chụp lại Mastery ngay thời điểm kết thúc để mỗi dòng thành tích giữ đúng "bản đồ" của lượt đó.
      let masterySnapshot = null;
      if (currentPlayerId) {
        try {
          masterySnapshot = await getMasterySnapshot(currentPlayerId, gameTypes, gameTables);
        } catch (err) {
          console.error('Không thể tạo snapshot Mastery:', err);
        }
      }

      addRecord({
        score,
        time: gameStartTime.toISOString(),
        playerName,
        types: gameTypes.map(t => ({ mul:'Nhân', div:'Chia', add:'Cộng', sub:'Trừ' }[t] || t)),
        rawTypes: [...gameTypes],
        tables: [...gameTables],
        duration: gameDurationMinutes,
        masterySnapshot
      });
      renderLeaderboard();
      await renderLearningDashboard();
      showResult(isGameOver, isVictory, isTimeUp);
    }

    function showResult(isGameOver = false, isVictory = false, isTimeUp = false) {
      let emoji, title;
      if (isGameOver === true) {
        emoji = '💀';
        title = 'Game Over!';
      } else if (isTimeUp === true) {
        emoji = score >= 20 ? '🏆' : score >= 10 ? '🎉' : score >= 5 ? '😊' : '😅';
        title = '⏱️ Hết giờ học!';
      } else {
        emoji = score >= 20 ? '🏆' : score >= 10 ? '🎉' : score >= 5 ? '😊' : '😅';
        title = score >= 20 ? 'Xuất sắc!' : score >= 10 ? 'Tuyệt vời!' : score >= 5 ? 'Không tệ!' : 'Cố lên nhé!';
      }
      document.getElementById('resultEmoji').textContent = emoji;
      document.getElementById('resultTitle').textContent = title;
      document.getElementById('resultScore').textContent = score + ' điểm';
      const typeLabels = gameTypes.map(t => {
        if (t === 'mul') return 'Nhân';
        if (t === 'div') return 'Chia';
        if (t === 'add') return 'Cộng';
        if (t === 'sub') return 'Trừ';
        return t;
      });
      const types = typeLabels.join(' + ');
      const durationText = `${gameDurationMinutes} phút`;
      document.getElementById('resultDetails').textContent =
        `Bảng ${gameTables.join(', ')} | ${types} | ${durationText}`;
      document.getElementById('resultOverlay').classList.add('open');
      if (isGameOver !== true) {
        spawnConfetti(score > 0 ? 60 : 0);
      }
    }

    function goHome() {
      document.getElementById('resultOverlay').classList.remove('open');
      showScreen('homeScreen');
      renderLeaderboard();
      renderLearningDashboard();
    }

    // ── UTILS ──────────────────────────────────────────────
    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    function spawnConfetti(count = 40) {
      const colors = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF922B', '#CC5DE8', '#20C997'];
      for (let i = 0; i < count; i++) {
        const d = document.createElement('div');
        d.className = 'confetti-piece';
        d.style.left = Math.random() * 100 + 'vw';
        d.style.background = colors[Math.floor(Math.random() * colors.length)];
        d.style.animationDuration = (1.5 + Math.random() * 2) + 's';
        d.style.animationDelay = (Math.random() * 0.8) + 's';
        d.style.transform = `rotate(${Math.random() * 360}deg)`;
        document.body.appendChild(d);
        d.addEventListener('animationend', () => d.remove());
      }
    }

    // ── AUDIO ─────────────────────────────────────────────
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Đọc văn bản tiếng Việt bằng Web Speech API
    let speakTimeout = null;
    let viVoice = null; // cache giọng tiếng Việt

    function loadVietnameseVoice() {
      const voices = window.speechSynthesis.getVoices();
      // Ưu tiên: vi-VN → vi → bất kỳ voice nào có "viet" trong tên
      viVoice =
        voices.find(v => v.lang === 'vi-VN') ||
        voices.find(v => v.lang.startsWith('vi')) ||
        voices.find(v => v.name.toLowerCase().includes('viet')) ||
        null;
    }

    if (window.speechSynthesis) {
      // getVoices() có thể trả về rỗng lần đầu, cần lắng nghe event
      loadVietnameseVoice();
      window.speechSynthesis.onvoiceschanged = loadVietnameseVoice;
    }

    function speakVietnamese(text, delay = 0, cancelPrev = true) {
      if (!window.speechSynthesis) return;
      clearTimeout(speakTimeout);
      if (cancelPrev) window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'vi-VN';   // luôn đặt lang = tiếng Việt
      if (viVoice) utter.voice = viVoice; // gán thẳng voice đã tìm được
      utter.rate = 1.05;
      utter.pitch = 1.1;
      utter.volume = 1;

      if (delay > 0) {
        speakTimeout = setTimeout(() => window.speechSynthesis.speak(utter), delay);
      } else {
        window.speechSynthesis.speak(utter);
      }
    }

    function playCorrectSound() {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      speakVietnamese('Đúng! Cộng một điểm.', 0, false);
    }

    function playWrongSound() {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // Đọc đầy đủ phép tính đúng khi trả lời sai
      speakVietnamese(`Sai! ${currentQuestionCorrectText}. Trừ một điểm.`, 0, false);
    }

    // ── INIT ──────────────────────────────────────────────
    dbReady.then(async () => {
      const profile = await getProfile();
      if (!profile) {
        document.getElementById('welcomeOverlay').classList.add('open');
      } else {
        currentPlayerId = profile.id;
        document.getElementById('greetingText').textContent = `Chào mừng ${profile.name} trở lại!`;
      }
      await renderLearningDashboard();
    });

    async function savePlayerName() {
      const name = document.getElementById('playerNameInput').value.trim();
      if (!name) return alert("Vui lòng nhập tên của bạn!");
      await addProfile(name);
      const profile = await getProfile();
      if (profile) currentPlayerId = profile.id;
      document.getElementById('welcomeOverlay').classList.remove('open');
      document.getElementById('greetingText').textContent = `Chào mừng ${name} trở lại!`;
      await renderLearningDashboard();
    }

    renderLeaderboard();

    // ── PWA INSTALL / SERVICE WORKER ─────────────────────
    let deferredInstallPrompt = null;

    function isStandaloneMode() {
      return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    }

    function isIOSDevice() {
      return /iphone|ipad|ipod/i.test(navigator.userAgent);
    }

    function updateInstallUI() {
      const card = document.getElementById('pwaInstallCard');
      const btn = document.getElementById('pwaInstallBtn');
      const hint = document.getElementById('pwaInstallHint');
      if (!card || !btn || !hint || isStandaloneMode()) {
        if (card) card.classList.remove('show');
        return;
      }

      if (deferredInstallPrompt) {
        hint.textContent = 'Cài lên màn hình chính để mở nhanh và học cả khi mất mạng.';
        btn.textContent = 'Cài ứng dụng';
        card.classList.add('show');
      } else if (isIOSDevice()) {
        hint.textContent = 'Trên iPhone/iPad: mở menu Chia sẻ rồi chọn “Thêm vào Màn hình chính”.';
        btn.textContent = 'Xem cách cài';
        card.classList.add('show');
      }
    }

    window.addEventListener('beforeinstallprompt', event => {
      // Chrome/Edge không đảm bảo luôn tự hiện banner; giữ event để dùng nút cài trong app.
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallUI();
    });

    document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } finally {
          deferredInstallPrompt = null;
          updateInstallUI();
        }
        return;
      }

      if (isIOSDevice()) {
        alert('Để cài ứng dụng trên iPhone/iPad:\n\n1. Mở trang này bằng Safari.\n2. Bấm nút Chia sẻ.\n3. Chọn “Thêm vào Màn hình chính”.\n4. Bấm “Thêm”.');
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      document.getElementById('pwaInstallCard')?.classList.remove('show');
    });

    window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallUI);
    window.addEventListener('load', updateInstallUI);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
          console.log('Service Worker registered successfully:', reg.scope);
          // Chủ động kiểm tra bản SW mới sau mỗi lần mở app.
          reg.update().catch(() => {});
        } catch (err) {
          console.error('Service Worker registration failed:', err);
        }
      });
    }

// ── STATIC UI EVENT BINDINGS ──────────────────────────────
// Giữ HTML thuần markup: toàn bộ hành vi click nằm trong app.js.
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  switch (action) {
    case 'open-setup': openSetup(); break;
    case 'close-setup': closeSetup(); break;
    case 'pause-game': pauseGame(); break;
    case 'resume-game': resumeGame(); break;
    case 'confirm-end-game': confirmEndGame(); break;
    case 'save-player-name': savePlayerName(); break;
    case 'toggle-type': toggleChip(target, 'type'); break;
    case 'toggle-duration': toggleDuration(target); break;
    case 'select-all-nums': selectAllNums(); break;
    case 'clear-all-nums': clearAllNums(); break;
    case 'start-game': startGame(); break;
    case 'go-home': goHome(); break;
  }
});
