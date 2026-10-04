---
target: vista de Hoy (TodayView)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Projects\\RunAnalyzer\\src\\components\\TodayView.jsx"
target_fingerprint: "sha256:34f77217d3241cb3f17e3b970114f695f1b54073c3e82c6ebbf1f17cd5c399b7"
target_path: "D:\\Projects\\RunAnalyzer\\src\\components\\TodayView.jsx"
timestamp: 2026-10-03T12-11-22Z
slug: src-components-todayview-jsx
closed: true
---
Method: dual-agent (A: a8bb2bf2c16589c9f · B: a5df4c296dbecd905). Source-only review; no browser.

## Design Health Score: 20/40 (Acceptable, low end)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Weekly sleep shown as if it were last night (TodayView.jsx:348) |
| 2 | Match System / Real World | 2 | "readiness" in English, TRIMP/TSB/ACWR/CTL as primary labels |
| 3 | User Control and Freedom | 2 | Recalcular always forces a new AI call |
| 4 | Consistency and Standards | 1 | Planned-session intensity colors contradict zone palette (TodayPlannedSession.jsx:6-12); local ZONES copy (TodayView.jsx:47-53) |
| 5 | Error Prevention | 2 | ACWR scale labels evenly spaced, values not proportional |
| 6 | Recognition Rather Than Recall | 3 | Banded scales with plain-word tags work |
| 7 | Flexibility and Efficiency | 2 | No collapse/reorder of daily blocks |
| 8 | Aesthetic and Minimalist Design | 1 | ~20 sub-blocks; phase/TSB repeated 4x |
| 9 | Error Recovery | 2 | Sync failure not surfaced |
| 10 | Help and Documentation | 2 | "Explícamelo" defers to chat; no inline "Cómo leer" |

## Design Specificity Verdict
Mostly generic fitness-dashboard skeleton (hero ring + KPI tiles + gauge grid + last-activity card) with genuinely runner-specific pieces (session profile, zone-colored splits, 80/20 ZoneStack, action-bearing readiness label). Signature surfaces break DESIGN.md: blur blobs (TodayView.jsx:844, 951-952), glow dots (:115), second full-width blue band. Detector: 3 findings, all false positives (hover-only bg; icon glyph sizes).

## Priority Issues
- [P1] Morning answer buried: session card is block 4 under a 6-gauge load panel. Fix: session in/under verdict band; collapse load; move last race out. /impeccable layout
- [P1] Readiness can be TSB-only yet look authoritative (athleteContext.js:95-104); weekly sleep presented as today. Fix: require >=2 wearable inputs or show unavailable state; label sleep as weekly. /impeccable harden
- [P1] Two-three competing prescriptions; AI validation warnings far from the session. Fix: one deterministic verdict, AI supports; move CoachBanners to session card. /impeccable distill
- [P2] DESIGN.md breaches on signature surfaces (blobs, glows, race band, intensity colors). /impeccable quieter
- [P2] Duplicate actions: 7 adjacent top controls, 5 chat entries, sync+recalcular. /impeccable distill

## Persona Red Flags
- Alex: fixed daily scroll past race strip and load grid; Recalcular always re-runs AI; AI text truncated at 420 chars.
- Sam: Ring/Scale expose no value/role; zone/week/split bars data only in title; color-only status; coach tabs lack tabpanel/arrow keys; missing focus-visible on race band, Calibrar FC, Recalcular; "Sin datos" slate-500 on slate-900 ~3.7:1.
- Casey: "Hoy toca" several scrolls down; 164px ring + 4 tiles fill first screen; ~28px tap targets; panel subtitles hidden on mobile; FAB may cover links.

## Minor Observations
cycleLabel unused; stray lg:col-span-7; "Sin objetivo" full blue banner daily; units at text-white/40; week bars use action blue for data; "Última carrera" duplicates SessionView; mixed language.

## Questions to Consider
1. What single line should the athlete read at 7am, and why isn't it first?
2. Does the load panel belong to the morning or the planning moment?
3. When AI and deterministic readiness disagree, which wins on screen?
4. What does a Strava-only first-timer see?
