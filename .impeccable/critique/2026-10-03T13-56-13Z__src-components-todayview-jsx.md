---
target: vista de Hoy (TodayView)
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:D:\\Projects\\RunAnalyzer\\src\\components\\TodayView.jsx"
target_fingerprint: "sha256:bbf1a1bf8c435efbefbd621531850c1803f7709515b0a9b5a5a88fcc3af4bf56"
target_path: "D:\\Projects\\RunAnalyzer\\src\\components\\TodayView.jsx"
timestamp: 2026-10-03T13-56-13Z
slug: src-components-todayview-jsx
---
Method: dual-agent (A: a25f2f04feef5b3bd · B: a1ee35aef16afce5d). Source-only review; no browser.

## Design Health Score: 23/40 (Acceptable)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | HRV can be weeks old with no staleness flag |
| 2 | Match System / Real World | 2 | TSB/ACWR/CTL bare; "Última carrera" vs "Carreras objetivo" |
| 3 | User Control and Freedom | 3 | Recalcular not cancellable |
| 4 | Consistency and Standards | 2 | Two sync buttons, two coach entries, "Ver la sesión" means scroll and navigate; emoji in CoachSettings |
| 5 | Error Prevention | 2 | Verdict can contradict itself |
| 6 | Recognition Rather Than Recall | 3 | Scales carry bands and labels |
| 7 | Flexibility and Efficiency | 2 | No send-to-watch |
| 8 | Aesthetic and Minimalist Design | 2 | 7 blocks; phase repeated 3x |
| 9 | Error Recovery | 2 | Garmin calendar fetch failure silent |
| 10 | Help and Documentation | 2 | Explanations only in title attributes |

## Design Specificity Verdict
Clear answer now leads, but the form is still the generic readiness-app template (dark hero, ring, 4 tiles). Product character lives in logic/copy; WorkoutProfile (the one authored visual) sits below. Missing "Mandar al reloj" on the session (the product's stated differentiator). App header still frosted glass (App.jsx:556). Detector: 2 advisory findings, both icon-glyph false positives; blobs/glows/gradients gone.

## Priority Issues
- [P0] Verdict mislabels the coach session as "Trote regenerativo" when recovery is true (TodayView.jsx:790) while showing the coach's hard targets. Fix: use coach type; when recovery, recommend auto regenerative and show coach session as proposed-not-recommended. /impeccable harden
- [P1] Readiness label cutoff (moderate >=45, athleteContext.js:111) disagrees with recovery gate (<50, TodayView.jsx:447); Garmin hard session on a bad day raises no conflict. Fix: one threshold table; scale volume in moderate band. /impeccable harden
- [P1] Coach session valid 48h (todaySession.js:30) with no check whether it was already run. Fix: drop if a run exists after generatedAt. /impeccable harden
- [P1] View hard-coded Spanish while default language is English (i18n.js:2044). /impeccable harden
- [P2] Strava-only users get a permanent empty dark hero; no loading state in useGarminWearableData so "Faltan señales" shows during load. /impeccable onboard

## Persona Red Flags
- Alex: verdict title twice, phase 3x, model chip noise, no send-to-watch, Recalcular most prominent button.
- Sam: no h1; unnamed copy-prompt, dismiss ✕ and hamburger buttons; "Hoy toca" button reads as one long label; WorkoutProfile/zone bars data only in title.
- Casey: hero single-column below xl; session detail ~700px down; ~16px tall detail/ask links.

## Minor Observations
BB "recargado" is day range not overnight; HRV tile color vs readiness band can disagree; calibration sample counts any runs as fallback; recovery quote cites both readiness and TSB; planned-session emerald icon + shadow-inner; dark DetailLink rounded-full pill.

## Questions to Consider
1. Why does the ring take half the hero if "Hoy toca" is the answer?
2. What does the Strava-only runner see?
3. Where is "Mandar al reloj"?
