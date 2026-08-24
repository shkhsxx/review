/**
 * auth.js
 * Supabase 인증 공용 모듈. index.html / save.html 등 어떤 페이지에서도
 * import해서 "지금 로그인한 사람이 누구인지"를 확인하거나 로그인 상태 변화를
 * 구독할 수 있다. (담기 기능 등 추후 로그인 필요 기능이 이 모듈을 재사용한다.)
 *
 * 비밀번호 처리/세션 관리는 전부 Supabase Auth에 위임하며, 이 파일은 그 위에
 * 얇은 래퍼(에러 메시지 한국어화 포함)만 제공한다.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://zjedljlghnbuyemqblrf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eMF3ZPcHQ47Nb0TUwwmQ5w_POovktjU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentUser = null;
let ready = false;
const listeners = new Set();

function notify() {
  listeners.forEach((cb) => cb(currentUser));
}

const initPromise = supabase.auth.getSession().then(({ data }) => {
  currentUser = data.session?.user ?? null;
  ready = true;
  notify();
});

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  if (ready) notify();
});

/** 현재 로그인한 사용자(Supabase User 객체) 또는 로그인하지 않았으면 null. */
export function getCurrentUser() {
  return currentUser;
}

/**
 * 로그인 상태가 바뀔 때마다 callback(user)을 호출한다.
 * 등록 시점에 이미 초기화가 끝났다면 현재 상태로 한 번 즉시 호출된다.
 * 반환값(구독 해제 함수)을 호출하면 더 이상 알림을 받지 않는다.
 */
export function onAuthChange(callback) {
  listeners.add(callback);
  if (ready) callback(currentUser);
  return () => listeners.delete(callback);
}

/** 세션 복원(새로고침 시 로그인 유지)이 끝날 때까지 기다린 뒤 현재 사용자를 반환한다. */
export async function waitForAuthReady() {
  await initPromise;
  return currentUser;
}

function mapAuthError(error) {
  const msg = error?.message || "";
  if (/invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (/user already registered|already been registered/i.test(msg)) return "이미 가입된 이메일입니다.";
  if (/password should be at least/i.test(msg)) return "비밀번호는 6자 이상이어야 합니다.";
  if (/email/i.test(msg) && /invalid/i.test(msg)) return "올바른 이메일 형식이 아닙니다.";
  if (/email not confirmed/i.test(msg)) return "이메일 인증이 필요합니다.";
  if (/rate limit|security purposes/i.test(msg)) return "잠시 후 다시 시도해주세요.";
  return msg || "알 수 없는 오류가 발생했습니다.";
}

/**
 * 이메일/비밀번호로 회원가입한다. 프로젝트의 이메일 인증(Confirm email)이
 * 꺼져 있으면 Supabase가 가입과 동시에 세션을 내려줘 바로 로그인된 상태가 된다.
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(mapAuthError(error));
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(mapAuthError(error));
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(mapAuthError(error));
}
