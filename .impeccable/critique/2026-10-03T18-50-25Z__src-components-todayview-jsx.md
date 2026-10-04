---
target: vista de Hoy (TodayView)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Projects\\RunAnalyzer\\src\\components\\TodayView.jsx"
target_fingerprint: "sha256:f8354ece08e3545893e6fe95a2a8ee5608edf830eb0670ffacb80aed701a7a7e"
target_path: "D:\\Projects\\RunAnalyzer\\src\\components\\TodayView.jsx"
timestamp: 2026-10-03T18-50-25Z
slug: src-components-todayview-jsx
---
Method: dual-agent (A: design review · B: detector). Source-only; no browser (no browser tool, view behind Google login).

## Design Health Score: 20/40 (Acceptable, low end)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Tiles say "No data" while Garmin loads; "Updated at" shown on failed sync (TodayView.jsx:294-306); data date truncated (:1027) |
| 2 | Match System / Real World | 2 | TSB/ACWR/CTL/PMC/VFC/spm/"autonomic state"/Z1–Z2 as primary labels |
| 3 | User Control and Freedom | 2 | Conflict says "consider swapping" with no swap/keep action; Recalculate always reruns AI |
| 4 | Consistency and Standards | 2 | "Optimal" for readiness and form phase; signal blue = good; Spanish hardcoded in EN UI (CoachAI.jsx:209) |
| 5 | Error Prevention | 2 | Stale wearables feed readiness, no age check (:332-335); HRV value vs 7d/60d delta |
| 6 | Recognition Rather Than Recall | 3 | Good scales/labels; some detail tooltip-only |
| 7 | Flexibility and Efficiency | 2 | No send-to-watch; load panel re-collapses every visit |
| 8 | Aesthetic and Minimalist Design | 2 | 7 blocks; form x3, analysis timestamp x2, session numbers x2 |
| 9 | Error Recovery | 2 | Spanish-only restore warning; "Not enough history yet" no next step; failed sync silent |
| 10 | Help and Documentation | 1 | No inline explainers; no «Cómo leer» panels |

## Design Specificity
Dark verdict band (:913-1032) is the one product-specific move; inside it a stock readiness ring + 4 equal tiles; below, identical white Panels. Craft lives in WorkoutProfile, banded Scale, zone stack. Detector: 2 advisory design-system-font-size findings (TodayView.jsx:103 text-[16px], TodayPlannedSession.jsx:33 text-[20px]), both false positives (icon glyph sizes). Review found off-token hex #38bdf8/#a78bfa (:129), text-[15px], sm:p-7, rounded-xl in CoachAI warning.

## Priority Issues
- [P1] Stale/mismatched watch data shown as "today" (:332-335, BB "today" note, HRV sparkline falls back to BB, 7d resting HR unlabeled, Updated-at on failed sync). Fix: per-tile date, >36h stale dim+exclude, sync time by eyebrow, catch sync errors. harden, clarify.
- [P1] Verdict self-contradicts (readiness Optimal + Recovery jog via overloaded TSB, :434-436) and flips after async loads. Fix: one causal sentence; skeleton until wearables + planned cache resolve. clarify, harden.
- [P1] Data→action loop not closed: no Send to Garmin, no Swap/Keep on conflict (:967-969, TodayPlannedSession.jsx:45-54), generic conflict cause. shape.
- [P2] Toolbar chrome above verdict (:879-910, "4×/sem", permanent Calibrate HR); two equal halves, three focal points. layout, distill.
- [P2] Jargon, no explainers, color meaning drift (hex :129, blue=good, green pulsing AI dot). clarify, colorize.

## Persona Red Flags
- Alex: no ATL; load panel re-collapses (:842); TSB rounded vs 1-decimal; Recalculate forces AI run; no send-to-watch.
- Sam: band h2 is a value (:932-937); "Today" is <p> (:964); scrollToSession no focus move; color-only tile tone; sparkline unlabeled; coach controls no focus-visible, Spanish labels; no aria-live.
- Casey: toolbar wraps 2 rows above verdict; tiles push session below fold; 16-28px targets; truncated date; tooltips on touch.
- Strava-only beginner: headline "No watch state"; PMC/Z1–Z2/TSB/ACWR/ramp/autonomic/spm; HR "—" unexplained; useful sentence buried (:789-791).

## Minor Observations
- TodayBalance.jsx dead code (only test imports it).
- distRange "3 – 3 km" (:447-449).
- text-[15px], my-[7px], sm:p-7 off-scale.
- Dark mode text-xs text-slate-500 without dark variant ~3.75:1.
- Garmin conflict inferred from title regex (todaySession.js:37) stated as fact.
- es: "Pulso" vs "FC"; day repeated in eyebrow + panel sub.

## Questions
- Why does an un-actionable 0-100 ring weigh as much as the session?
- Should Today show load only when it changes the verdict?
- Why is the Strava-only beginner the degraded state rather than designed first?
