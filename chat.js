// Chat: one channel for everyone who is in the menus ("all"), and one for each room.
//
// What it is, and why it is built like this:
//
// - The server is the only memory. The last CHAT_KEEP messages of each channel are kept in a
//   ring here, in RAM, and handed to whoever opens the chat. Nothing is written to disk and
//   nothing is kept in the browser: a room's chat goes when the room does, and the channel
//   for everyone starts clean whenever the server restarts (on free hosting, whenever it has
//   been asleep). That is deliberate - no database to run, no old conversation hanging about
//   out of context, nothing personal stored anywhere.
// - Nobody is trusted. Every message is cut to CHAT_MAX characters, stripped of control
//   characters, and softened: links are replaced (strangers do not get to send each other
//   anywhere), long runs of digits too (phone numbers), and the commonest swear words are
//   starred out. It is a courtesy filter, not a moderator - see README.
// - Nobody may flood. Each connection has a token bucket (a short burst, then a slow
//   trickle), may not say the same thing twice in a row, and is shut out for a while after
//   repeated tries while the bucket is empty.
// - A message is plain text from end to end; the client only ever sets it as textContent.
//
// This file knows nothing about sockets: server.js wires it up.

export const CHAT_MAX = 140; // characters in one message
export const CHAT_KEEP = 60; // messages remembered per channel
const BURST = 5; // messages that may come at once
const REFILL_MS = 2500; // then one more every so often
const STRIKES = 3; // tries while empty before being shut out
const SHUT_MS = 20000; // for this long

// --- the text ---------------------------------------------------------------------------
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|gg|io|co|me|tv|ly|xyz|app|dev|info|biz|ru|uk|de)\b(?:\/\S*)?/gi;
const DIGITS = /\d(?:[\s().-]?\d){6,}/g;
// (kept short on purpose: the words most often thrown at people, in their plain and their
// most common disguised spellings. Matched as whole words, so "class" and "Scunthorpe" pass.)
const ROUGH = ['fuck', 'fucking', 'fucker', 'fck', 'fuk', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kys', 'rape'];
const plain = (word) => word.toLowerCase().replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/(.)\1{2,}/g, '$1');
const ROUGH_SET = new Set(ROUGH);

export function cleanText(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ') // control characters, and the ones that turn text round
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);
}

export function soften(text) {
  return text
    .replace(LINK, '[link]')
    .replace(DIGITS, '[number]')
    .replace(/[\p{L}\p{N}@$!|]+/gu, (word) => (ROUGH_SET.has(plain(word)) ? '*'.repeat(word.length) : word))
    .trim();
}

// --- who may speak, and how often ---------------------------------------------------------
// One per connection. `take(now)` -> { ok } or { ok: false, wait (ms), shut (true when shut out) }
export function makeSpeaker() {
  return { tokens: BURST, at: 0, strikes: 0, shutUntil: 0, last: '' };
}
export function take(sp, now) {
  if (now < sp.shutUntil) return { ok: false, wait: sp.shutUntil - now, shut: true };
  if (sp.at) sp.tokens = Math.min(BURST, sp.tokens + (now - sp.at) / REFILL_MS);
  sp.at = now;
  if (sp.tokens < 1) {
    if (++sp.strikes >= STRIKES) {
      sp.strikes = 0;
      sp.shutUntil = now + SHUT_MS;
      return { ok: false, wait: SHUT_MS, shut: true };
    }
    return { ok: false, wait: Math.ceil((1 - sp.tokens) * REFILL_MS), shut: false };
  }
  sp.tokens -= 1;
  sp.strikes = 0;
  return { ok: true };
}

// --- a channel's memory -----------------------------------------------------------------
let seq = 0;
export function makeLog() {
  return [];
}
// add a message to a log (dropping the oldest beyond CHAT_KEEP) and hand it back, ready to send
//   m: { to: 'all' | 'room', from, name, text, sys? }
export function remember(log, m, now = Date.now()) {
  const msg = { id: ++seq, at: now, ...m };
  log.push(msg);
  if (log.length > CHAT_KEEP) log.splice(0, log.length - CHAT_KEEP);
  return msg;
}
