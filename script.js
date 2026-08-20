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
  transition: document.querySelector("#transition-button"),
};

// 通常の2モードに加え、どちらへの切替を待っているかも明示的に管理します。
const APP_STATES = {
  FOCUS: "focus",
  WAITING_FOR_BREAK: "waiting-for-break",
  BREAK: "break",
  WAITING_FOR_FOCUS: "waiting-for-focus",
};

let isTestMode = false;
let appState = APP_STATES.FOCUS;
let remainingSeconds = TIMER_SETTINGS.normal.focus;
let completedPomodoros = 0;
let timerId = null;
let nextTickAt = null;
let audioContext = null;
let notificationIntervalId = null;

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
  const isFocusState = appState === APP_STATES.FOCUS || appState === APP_STATES.WAITING_FOR_BREAK;
  const modeName = isFocusState ? "集中" : "休憩";
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
  if (appState === APP_STATES.WAITING_FOR_BREAK) {
    document.title = "🔔 集中終了｜休憩してください｜ポモドーロ";
  } else if (appState === APP_STATES.WAITING_FOR_FOCUS) {
    document.title = "🔔 休憩終了｜集中を開始｜ポモドーロ";
  } else {
    const testTitle = isTestMode ? "TEST MODE｜" : "";
    document.title = `${testTitle}${formattedTime}｜${modeName}｜ポモドーロ`;
  }
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

// 終了時だけ呼び、短い音を約2秒おきに繰り返します。二重開始はしません。
function startRepeatingNotification() {
  if (notificationIntervalId !== null) return;
  playNotificationSound();
  notificationIntervalId = window.setInterval(playNotificationSound, 2000);
}

// 次モード開始・リセット・TEST切替のどこからでも、同じ方法で通知を止めます。
function stopRepeatingNotification() {
  if (notificationIntervalId === null) return;
  window.clearInterval(notificationIntervalId);
  notificationIntervalId = null;
}

// 00:00になった瞬間にカウントを止め、自動遷移せず「切替待ち」にします。
function finishTimer() {
  if (timerId !== null) window.clearInterval(timerId);
  timerId = null;
  remainingSeconds = 0;

  if (appState === APP_STATES.FOCUS) {
    completedPomodoros = Math.min(completedPomodoros + 1, TIMER_SETTINGS.goal);
    appState = APP_STATES.WAITING_FOR_BREAK;
    elements.message.textContent = "集中終了！休憩しましょう";
    elements.transition.textContent = "休憩を開始";
  } else {
    appState = APP_STATES.WAITING_FOR_FOCUS;
    elements.message.textContent = "休憩終了！次の集中を始めましょう";
    elements.transition.textContent = "集中を開始";
  }

  elements.transition.hidden = false;
  setRunningState(false);
  // 切替待ち中は通常の「開始」ではなく、専用ボタンだけを主操作にします。
  elements.start.disabled = true;
  updateBodyClasses();
  updateDisplay();
  startRepeatingNotification();
}

// 時刻との差から残り時間を求め、タブが非表示でも大きくずれにくくします。
function tick() {
  const now = Date.now();
  if (now < nextTickAt) return;

  const elapsedSeconds = Math.floor((now - nextTickAt) / 1000) + 1;
  remainingSeconds = Math.max(0, remainingSeconds - elapsedSeconds);
  nextTickAt += elapsedSeconds * 1000;

  if (remainingSeconds === 0) finishTimer();
  updateDisplay();
}

function startTimer() {
  if (timerId || appState === APP_STATES.WAITING_FOR_BREAK || appState === APP_STATES.WAITING_FOR_FOCUS) return;

  // 音声はユーザー操作後に初期化する必要があります。
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass && !audioContext) audioContext = new AudioContextClass();
  if (audioContext?.state === "suspended") audioContext.resume();

  nextTickAt = Date.now() + 1000;
  timerId = window.setInterval(tick, 200);
  elements.message.textContent = appState === APP_STATES.FOCUS ? "集中しています…" : "休憩中です…";
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
  stopRepeatingNotification();
  appState = APP_STATES.FOCUS;
  remainingSeconds = getDurations().focus;
  completedPomodoros = 0;
  elements.transition.hidden = true;
  updateBodyClasses();
  elements.message.textContent = "集中する準備はできましたか？";
  setRunningState(false);
  updateDisplay();
}

function updateBodyClasses() {
  const isBreakState = appState === APP_STATES.BREAK || appState === APP_STATES.WAITING_FOR_FOCUS;
  document.body.classList.toggle("focus-mode", !isBreakState);
  document.body.classList.toggle("break-mode", isBreakState);
  document.body.classList.toggle("transition-waiting", appState.includes("waiting"));
  document.body.classList.toggle("test-mode", isTestMode);
}

// 目立つ切替ボタンで通知を止め、次モードの時間を設定して直ちに開始します。
function startNextMode() {
  if (appState === APP_STATES.WAITING_FOR_BREAK) {
    appState = APP_STATES.BREAK;
    remainingSeconds = getDurations().break;
  } else if (appState === APP_STATES.WAITING_FOR_FOCUS) {
    appState = APP_STATES.FOCUS;
    remainingSeconds = getDurations().focus;
  } else {
    return;
  }

  stopRepeatingNotification();
  elements.transition.hidden = true;
  updateBodyClasses();
  updateDisplay();
  startTimer();
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
elements.transition.addEventListener("click", startNextMode);

updateDisplay();
