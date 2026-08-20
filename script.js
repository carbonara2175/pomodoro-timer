// タイマーの長さを秒で管理します。長時間休憩を追加するときも、この設定を拡張できます。
const TIMER_SETTINGS = {
  normal: { focus: 25 * 60, break: 5 * 60 },
  test: { focus: 10, break: 5 },
  goal: 4,
};

const elements = {
  time: document.querySelector("#time-display"),
  mode: document.querySelector("#mode-text"),
  message: document.querySelector("#status-message"),
  count: document.querySelector("#pomodoro-count"),
  dots: document.querySelectorAll(".progress-dots span"),
  start: document.querySelector("#start-button"),
  pause: document.querySelector("#pause-button"),
  reset: document.querySelector("#reset-button"),
  test: document.querySelector("#test-button"),
  testIndicator: document.querySelector("#test-mode-indicator"),
};

let isTestMode = false;
let currentMode = "focus";
let remainingSeconds = TIMER_SETTINGS.normal.focus;
let completedPomodoros = 0;
let timerId = null;
let nextTickAt = null;
let audioContext = null;

function getDurations() {
  return isTestMode ? TIMER_SETTINGS.test : TIMER_SETTINGS.normal;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// 画面とブラウザのタブを、現在の状態に合わせてまとめて更新します。
function updateDisplay() {
  const modeName = currentMode === "focus" ? "集中" : "休憩";
  const formattedTime = formatTime(remainingSeconds);

  elements.time.textContent = formattedTime;
  elements.time.setAttribute(
    "aria-label",
    `残り時間 ${Math.floor(remainingSeconds / 60)}分${remainingSeconds % 60}秒`,
  );
  elements.mode.textContent = modeName;
  elements.count.textContent = `🍅 ${completedPomodoros} / ${TIMER_SETTINGS.goal}`;
  elements.dots.forEach((dot, index) => {
    dot.classList.toggle("complete", index < completedPomodoros);
  });
  const testTitle = isTestMode ? "TEST MODE｜" : "";
  document.title = `${testTitle}${formattedTime}｜${modeName}｜ポモドーロ`;
}

function setRunningState(isRunning) {
  elements.start.disabled = isRunning;
  elements.pause.disabled = !isRunning;
}

// 外部ファイルを使わず、Web Audio APIで短い通知音を作ります。
function playNotificationSound() {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
  gain.gain.setValueAtTime(0.18, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.35);
}

function switchMode() {
  playNotificationSound();

  if (currentMode === "focus") {
    // 目標の4回に達した後は「4 / 4」の達成表示を保ちます。
    completedPomodoros = Math.min(completedPomodoros + 1, TIMER_SETTINGS.goal);
    currentMode = "break";
    remainingSeconds = getDurations().break;
    elements.message.textContent = "集中完了！休憩してリフレッシュしましょう。";
  } else {
    currentMode = "focus";
    remainingSeconds = getDurations().focus;
    elements.message.textContent = "休憩完了！次の集中を始めましょう。";
  }

  updateBodyClasses();
  updateDisplay();
}

// 時刻との差から残り時間を求め、タブが非表示でも大きくずれにくくします。
function tick() {
  const now = Date.now();
  if (now < nextTickAt) return;

  const elapsedSeconds = Math.floor((now - nextTickAt) / 1000) + 1;
  remainingSeconds = Math.max(0, remainingSeconds - elapsedSeconds);
  nextTickAt += elapsedSeconds * 1000;

  if (remainingSeconds === 0) switchMode();
  updateDisplay();
}

function startTimer() {
  if (timerId) return;

  // 音声はユーザー操作後に初期化する必要があります。
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass && !audioContext) audioContext = new AudioContextClass();
  if (audioContext?.state === "suspended") audioContext.resume();

  nextTickAt = Date.now() + 1000;
  timerId = window.setInterval(tick, 200);
  elements.message.textContent = currentMode === "focus" ? "集中しています…" : "休憩中です…";
  setRunningState(true);
}

function pauseTimer() {
  if (!timerId) return;
  window.clearInterval(timerId);
  timerId = null;
  elements.message.textContent = "一時停止しました。いつでも再開できます。";
  setRunningState(false);
}

function resetTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
  currentMode = "focus";
  remainingSeconds = getDurations().focus;
  completedPomodoros = 0;
  updateBodyClasses();
  elements.message.textContent = "集中する準備はできましたか？";
  setRunningState(false);
  updateDisplay();
}

function updateBodyClasses() {
  document.body.classList.toggle("focus-mode", currentMode === "focus");
  document.body.classList.toggle("break-mode", currentMode === "break");
  document.body.classList.toggle("test-mode", isTestMode);
}

function toggleTestMode() {
  isTestMode = !isTestMode;
  elements.test.setAttribute("aria-pressed", String(isTestMode));
  elements.testIndicator.hidden = !isTestMode;
  resetTimer();
}

elements.start.addEventListener("click", startTimer);
elements.pause.addEventListener("click", pauseTimer);
elements.reset.addEventListener("click", resetTimer);
elements.test.addEventListener("click", toggleTestMode);

updateDisplay();
