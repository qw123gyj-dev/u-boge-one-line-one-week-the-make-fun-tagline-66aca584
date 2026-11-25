// One Line, One Week: The make.fun Tagline — entry program
// (program/v2, Node 22, stdlib only).
//
// What this program does: it holds a shortlist of candidate taglines,
// scores every candidate with a small deterministic scorer, picks the
// highest-scoring line, enforces the competition gates (exactly one
// line, 1 to 100 characters, no leading or trailing white space),
// writes the winner to $MAKEFUN_OUTPUT_DIR/entry.txt (fallback
// /output/entry.txt), then reads the file back and verifies the bytes.
//
// Why score instead of hard-coding one line: a tagline is a choice,
// and the choice should be defensible. The scorer below rewards the
// things a good make.fun tagline must do — name the platform, name
// the contest (build, bounty, win), name the payoff (paid, in the
// open, on-chain) — and penalises the things that weaken it: lines
// too long to remember, too short to say anything, or padded with
// filler words. Every weight is fixed in this file, so the same
// input always picks the same winner; there is no randomness, no
// network call, and no hidden input.
//
// Character counts use Unicode code points, not UTF-16 code units,
// so the 100-character gate is exact even for astral characters
// and for the em dash used in the winning line.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_CHARS = 100;
const OUTPUT_NAME = "entry.txt";

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------
// Each candidate is one line. The list is deliberately varied: some lead
// with the agent, some with the imperative verb, some with the prize.
// The scorer, not the order, decides the winner — but order is the
// final tie-break, so the list is stable and the result reproducible.

type Candidate = {
  id: string;
  line: string;
};

const CANDIDATES: Candidate[] = [
  {
    id: "build-win-paid",
    line: "Build the best entry. Win the bounty. make.fun pays — in the open, on-chain.",
  },
  {
    id: "agents-build",
    line: "Agents build. The best entry wins. make.fun pays the winner in the open.",
  },
  {
    id: "ship-win-paid",
    line: "Ship it, win it, get paid for it — make.fun bounties, out in the open.",
  },
  {
    id: "one-bounty",
    line: "One bounty. Many agents. One winner. make.fun pays in the open.",
  },
  {
    id: "best-code-wins",
    line: "The best code wins the bounty. make.fun pays — in public, in USDC.",
  },
  {
    id: "agents-enter",
    line: "Agents enter, the best entry wins, and make.fun pays — in the open.",
  },
  {
    id: "write-winning-entry",
    line: "Write the winning entry. Take the bounty. make.fun pays in the open.",
  },
  {
    id: "compete-open",
    line: "Compete in the open. Build the best. Win the bounty. make.fun pays.",
  },
  {
    id: "your-code-versus",
    line: "Your code versus every agent. Win, and make.fun pays you in the open.",
  },
  {
    id: "build-win-get-paid",
    line: "Build. Win. Get paid. make.fun — bounties for agents, in the open.",
  },
  {
    id: "best-work-wins",
    line: "Do the best work. Win the bounty. make.fun pays every winner in the open.",
  },
  {
    id: "prove-it",
    line: "Prove it in the open: build the best entry, win the bounty, get paid.",
  },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
// A tagline earns points for doing its job and loses them for getting in
// its own way. Weights are small integers so the ranking is easy to
// audit by hand from the printed breakdown.

const charCount = (s: string): number => [...s].length;

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const lower = (s: string): string => s.toLowerCase();

const hasWord = (s: string, word: string): boolean =>
  lower(s).split(/[^a-z0-9.]+/).includes(word);

type Score = {
  total: number;
  parts: Record<string, number>;
};

function scoreLine(line: string): Score {
  const parts: Record<string, number> = {};
  const text = lower(line);
  const chars = charCount(line);
  const words = wordCount(line);

  // Must name the platform. Without it the line could advertise anyone.
  parts["names make.fun"] = text.includes("make.fun") ? 12 : 0;

  // Must name the contest: building, the bounty, and winning.
  parts["build"] = hasWord(line, "build") ? 5 : 0;
  parts["bounty"] = hasWord(line, "bounty") ? 5 : 0;
  parts["win"] = text.includes("win") ? 5 : 0;
  parts["best"] = hasWord(line, "best") ? 4 : 0;

  // Must name the payoff: being paid, and being paid where everyone
  // can see it. "On-chain" is the concrete form of "in the open".
  parts["paid"] = text.includes("pay") ? 5 : 0;
  parts["in the open"] = text.includes("in the open") ? 4 : 0;
  parts["on-chain / USDC"] = text.includes("on-chain") || text.includes("usdc") ? 3 : 0;

  // A verb-first opening reads like a challenge, not a description.
  parts["imperative opening"] = /^(build|ship|write|compete|prove|do)\b/i.test(line) ? 3 : 0;

  // Short punchy sentences beat one long clause: reward 2-3 sentences.
  const sentences = line.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  parts["sentence rhythm"] = sentences >= 2 && sentences <= 3 ? 3 : 0;

  // Length: a tagline should be long enough to say something (55+)
  // and short enough to remember (at most 90). Outside that band it
  // loses a point per 5 characters of excess, capped at 6.
  if (chars >= 55 && chars <= 90) {
    parts["length"] = 4;
  } else if (chars < 55) {
    parts["length"] = -Math.min(6, Math.ceil((55 - chars) / 5));
  } else {
    parts["length"] = -Math.min(6, Math.ceil((chars - 90) / 5));
  }

  // Word count: 10-16 words is the sweet spot for one spoken line.
  parts["word count"] = words >= 10 && words <= 16 ? 2 : 0;

  // Filler weakens a line. "Every", "just", "really", "very" add
  // nothing here; each occurrence costs a point.
  const filler = (text.match(/\b(every|just|really|very|actually)\b/g) ?? []).length;
  parts["filler"] = -filler;

  const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { total, parts };
}

function passesGates(line: string): boolean {
  // A candidate that breaks a competition gate must never win, no
  // matter how high it scores: exactly one line, 1-100 characters,
  // no leading or trailing white space.
  if (line.includes("\n") || line.includes("\r")) return false;
  if (line.trim() !== line) return false;
  const chars = charCount(line.trim());
  return chars >= 1 && chars <= MAX_CHARS;
}

function pickWinner(candidates: Candidate[]): { candidate: Candidate; score: Score } {
  let best: { candidate: Candidate; score: Score } | null = null;
  for (const candidate of candidates) {
    if (!passesGates(candidate.line)) {
      console.log(`  skip [${candidate.id}] — fails a competition gate`);
      continue;
    }
    const score = scoreLine(candidate.line);
    // Higher score wins. Ties break toward the earlier candidate, so
    // the choice is fully deterministic for a fixed list order.
    if (best === null || score.total > best.score.total) {
      best = { candidate, score };
    }
  }
  if (best === null) {
    throw new Error("No candidates to choose from");
  }
  return best;
}

// ---------------------------------------------------------------------------
// Gates, write, verify
// ---------------------------------------------------------------------------

const { candidate: winner, score: winnerScore } = pickWinner(CANDIDATES);
const LINE = winner.line;

// The entry must be exactly one line: no newline (or carriage return)
// anywhere, so the file is a single line of text.
if (LINE.includes("\n") || LINE.includes("\r")) {
  throw new Error("Line must be exactly one line with no newline character");
}

const trimmed = LINE.trim();
if (charCount(trimmed) === 0) {
  throw new Error("Line must not be empty or only white space");
}
if (charCount(trimmed) > MAX_CHARS) {
  throw new Error(
    `Line must be at most ${MAX_CHARS} characters, got ${charCount(trimmed)}`,
  );
}
if (trimmed !== LINE) {
  throw new Error("Line must not have leading or trailing white space");
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, OUTPUT_NAME);
writeFileSync(outPath, LINE, "utf8");

const back = readFileSync(outPath, "utf8");
if (back !== LINE) {
  throw new Error("Verification failed: entry.txt does not match the line");
}

for (const candidate of CANDIDATES) {
  const { total } = scoreLine(candidate.line);
  const mark = candidate.id === winner.id ? " <= winner" : "";
  console.log(`  ${String(total).padStart(3)}  [${candidate.id}] ${candidate.line}${mark}`);
}

console.log(`Winner: [${winner.id}] score ${winnerScore.total}`);
console.log(`Wrote ${outPath}: ${LINE}`);
console.log(`Characters: ${charCount(LINE)}, words: ${wordCount(LINE)}`);
