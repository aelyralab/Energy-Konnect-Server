/**
 * Password hashing (Argon2id via @node-rs/argon2 — prebuilt native binaries,
 * so it installs cleanly on Windows without node-gyp / Visual Studio Build
 * Tools, unlike the `argon2` or `bcrypt` packages).
 */
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended baseline for Argon2id as of 2024: 19 MiB memory, 2
// iterations, 1 degree of parallelism. Deliberately not maxed out — this runs
// on every login and register, and the API must stay responsive under load.
const HASH_OPTIONS = {
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
  algorithm: 2, // argon2id
};

export async function hashPassword(plainText) {
  return hash(plainText, HASH_OPTIONS);
}

export async function verifyPassword(plainText, hashed) {
  try {
    return await verify(hashed, plainText);
  } catch {
    // Malformed/foreign hash (e.g. a bcrypt hash from a future migration) —
    // treat as a failed match rather than letting the error propagate.
    return false;
  }
}
