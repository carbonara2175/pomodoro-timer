"use strict";
const PRESETS = { standard: [1500, 300], short: [900, 300], long: [3000, 600] };
const STORAGE_KEY = "pomodoro-v2";
const $ = id => document.getElementById(id);
const messages = ["少し席を立ちましょう", "遠くを見て目を休めましょう", "肩や首を軽く動かしましょう", "次の集中に向けて一息つきましょう", "今は休憩時間です。作業から離れましょう"];
let data = { version: 2, settings: { preset: "standard", longEnabled: true, longMinutes: 15 }, days: {}, setCount: 0, session: null };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved?.version === 2 && saved.days && PRESETS[saved.settings?.preset] && [15,20,30].includes(saved.settings.longMinutes)) data = saved;
} catch { /* 保存データが読めない場合もタイマーを使用可能にする */ }
let isTestMode = false;
let testData = { days: {}, setCount: 0, session: null };
let session = data.session || newSession("focus");
let running = false;
let lastAt = null;
let timerId = null;
let audioContext = null;
let notificationIntervalId = null;
const activeSounds = new Set();
let breakMessageIndex = 0;
function store() { return isTestMode ? testData : data; }
function localDate(at = Date.now()) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function day(at = Date.now()) {
  const key = localDate(at);
  return store().days[key] ||= { completed: 0, focusSeconds: 0 };
}
function duration(mode) {
  if (isTestMode) return mode === "focus" ? 10 : mode === "break" ? 5 : data.settings.longMinutes;
  return mode === "long-break" ? data.settings.longMinutes * 60 : PRESETS[data.settings.preset][mode === "focus" ? 0 : 1];
}
function newSession(mode) {
  return { mode, remainingMs: duration(mode)*1000, eligible: false, waiting: false, started: false };
}
function save() {
  store().session = session;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); $("save-warning").hidden = true; }
  catch { $("save-warning").hidden = false; }
}
// 日付をまたぐ区間は端末のローカル深夜で分割。待機・休憩は呼び出さない。
function recordFocus(from, to) {
  while (from < to) {
    const d = new Date(from);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1).getTime();
    const end = Math.min(to, midnight);
    day(from).focusSeconds += (end-from)/1000;
    from = end;
  }
}
function sync(now = Date.now()) {
  if (!running) return;
  const elapsed = Math.min(session.remainingMs, Math.max(0, now-lastAt));
  if (session.mode === "focus") recordFocus(lastAt, lastAt+elapsed);
  session.remainingMs = Math.max(0, session.remainingMs-elapsed);
  lastAt = now;
  if (session.remainingMs === 0) finishTimer();
  save();
}
function stopTimer() {
  running = false;
  if (timerId !== null) window.clearInterval(timerId);
  timerId = null;
}
function finishTimer() {
  if (!running || session.waiting) return;
  stopTimer();
  session.waiting = true;
  if (session.mode === "focus") session.eligible = true;
  startRepeatingNotification();
  showDesktopNotification(session.mode);
}
function formatTime(seconds) {
  return `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}
function render() {
  const focus = session.mode === "focus";
  const seconds = Math.ceil(session.remainingMs/1000);
  const name = focus ? "集中" : session.mode === "long-break" ? "長い休憩" : "短い休憩";
  $("time-display").textContent = formatTime(seconds);
  $("time-display").setAttribute("aria-label", `残り時間 ${Math.floor(seconds/60)}分${seconds%60}秒`);
  $("mode-text").textContent = `${isTestMode ? "TEST・" : ""}${name}`;
  $("status-message").textContent = session.waiting ? (focus ? "集中終了！延長または休憩へ" : "休憩終了！次の集中へ") : running ? (focus ? "集中しています…" : "休憩中です…") : session.started ? "一時停止中・開始で再開" : "開始を押して始めましょう";
  $("transition-button").textContent = focus ? "休憩へ進む" : session.waiting ? "次の集中へ" : "休憩スキップ";
  $("extensions").hidden = !(focus && session.waiting);
  $("extend-five").textContent = isTestMode ? "＋5秒延長" : "＋5分延長";
  $("extend-ten").textContent = isTestMode ? "＋10秒延長" : "＋10分延長";
  $("start-button").disabled = running || session.waiting;
  $("start-button").textContent = session.started && !session.waiting ? "再開" : "開始";
  $("pause-button").disabled = !running;
  $("break-message").hidden = focus;
  $("break-message").textContent = messages[breakMessageIndex];
  const today = day();
  $("pomodoro-count").textContent = `${isTestMode ? "TESTの集中" : "今日の集中"}：${today.completed}回`;
  const minutes = Math.floor(today.focusSeconds/60);
  $("focus-total").textContent = isTestMode ? `TEST累計集中時間：${Math.floor(today.focusSeconds)}秒` : `累計集中時間：${minutes >= 60 ? Math.floor(minutes/60)+"時間" : ""}${minutes%60}分`;
  $("set-progress").textContent = `セット内の集中：${store().setCount} / 4`;
  document.querySelectorAll(".progress-dots span").forEach((dot,i) => dot.classList.toggle("complete", i<store().setCount));
  document.body.classList.toggle("focus-mode",focus);
  document.body.classList.toggle("break-mode",!focus);
  document.body.classList.toggle("transition-waiting",session.waiting);
  $("test-button").setAttribute("aria-pressed",String(isTestMode));
  $("test-mode-indicator").hidden = !isTestMode;
  document.title = `${isTestMode ? "TEST｜" : ""}${session.waiting ? "🔔 終了" : formatTime(seconds)}｜${name}｜ポモドーロ`;
}
function prepareAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio && !audioContext) audioContext = new Audio();
    if (audioContext?.state === "suspended") audioContext.resume()?.catch(()=>{});
  } catch { /* 音声が使えなくても進行 */ }
}
function startTimer() {
  if (running || session.waiting) return;
  prepareAudio();
  requestDesktopNotificationPermission();
  running = true;
  session.started = true;
  lastAt = Date.now();
  timerId = window.setInterval(() => { sync(); render(); },200);
  save(); render();
}
function pauseTimer() { sync(); stopTimer(); save(); render(); }
// 完了回数はセッションを離れる時だけ確定。延長や終了通知では増やさない。
function closeFocus() {
  if (session.mode === "focus" && session.eligible) {
    day().completed++;
    store().setCount++;
  }
}
function nextStep() {
  sync(); stopTimer(); stopRepeatingNotification();
  const previous = session.mode;
  closeFocus();
  if (previous === "focus") {
    const longBreak = data.settings.longEnabled && store().setCount >= 4;
    session = newSession(longBreak ? "long-break" : "break");
    if (!longBreak && store().setCount >= 4) store().setCount = 0;
    breakMessageIndex = (breakMessageIndex+1)%messages.length;
  } else {
    if (previous === "long-break") store().setCount = 0;
    session = newSession("focus");
  }
  save(); render();
}
function extend(minutes) {
  if (session.mode !== "focus" || !session.waiting) return;
  stopRepeatingNotification();
  session.remainingMs = minutes*(isTestMode ? 1000 : 60000);
  session.waiting = false;
  startTimer();
}
function resetTimer() {
  sync(); stopTimer(); stopRepeatingNotification();
  closeFocus();
  session = newSession("focus");
  save(); render();
}
function toggleTestMode() {
  sync(); stopTimer(); stopRepeatingNotification(); save();
  isTestMode = !isTestMode;
  if (isTestMode) { testData = { days:{}, setCount:0, session:null }; session = newSession("focus"); }
  else { session = data.session || newSession("focus"); testData = { days:{}, setCount:0, session:null }; }
  save(); render();
}
function requestDesktopNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;

  // 許可確認はブラウザが認めるユーザー操作（最初の「開始」）からだけ行います。
  try {
    const permissionRequest = Notification.requestPermission();
    // 古いブラウザではPromiseが返らないこともあるため、存在するときだけ処理します。
    permissionRequest?.catch(() => {
      // 許可画面を出せない環境でも、通知音と画面表示は継続します。
    });
  } catch {
    // HTTPS外などで許可を要求できなくても、タイマーは止めません。
  }
}

// 各タイマーの終了時に一度だけ呼び出し、クリック時は既存画面へ戻ろうとします。
function showDesktopNotification(completedState) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const isFocusComplete = completedState === "focus";
  try {
    const notification = new Notification(isFocusComplete ? "集中終了" : "休憩終了", {
      body: isFocusComplete ? "休憩へ進むか、集中を延長できます" : "次の集中を開始してください",
      tag: `pomodoro-${completedState}-complete`,
    });

    notification.onclick = () => {
      notification.close();
      // OSの制約で最前面にならない場合がありますが、新しいタブは開きません。
      window.focus();
    };
  } catch {
    // 通知の作成に失敗しても、タイマーや繰り返し通知音には影響させません。
  }
}

function playNotificationSound() {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
  gain.gain.setValueAtTime(0.18, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);
  activeSounds.add(oscillator);
  oscillator.onended = () => activeSounds.delete(oscillator);
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
  for (const oscillator of activeSounds) { try { oscillator.stop(); } catch {} }
  activeSounds.clear();
  if (notificationIntervalId === null) return;
  window.clearInterval(notificationIntervalId);
  notificationIntervalId = null;
}


$("start-button").addEventListener("click",startTimer);
$("pause-button").addEventListener("click",pauseTimer);
$("reset-button").addEventListener("click",resetTimer);
$("test-button").addEventListener("click",toggleTestMode);
$("transition-button").addEventListener("click",nextStep);
$("extend-five").addEventListener("click",()=>extend(5));
$("extend-ten").addEventListener("click",()=>extend(10));
$("preset").value = data.settings.preset;
$("long-enabled").checked = data.settings.longEnabled;
$("long-minutes").value = String(data.settings.longMinutes);
for (const id of ["preset","long-enabled","long-minutes"]) $(id).addEventListener("change",()=> {
  sync();
  data.settings = { preset: $("preset").value, longEnabled: $("long-enabled").checked, longMinutes: Number($("long-minutes").value) };
  save(); render();
});
document.addEventListener("visibilitychange",()=>{ sync(); render(); });
window.addEventListener("pagehide",()=>{ sync(); stopTimer(); save(); });
window.addEventListener("pageshow",()=>render());
// 日付表示は停止中も更新する。閉じている時間は記録しない。
window.setInterval(()=>render(),1000);
if (session.waiting) { prepareAudio(); startRepeatingNotification(); }
save(); render();
