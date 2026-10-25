# with-lead

The plugin as it was before 2026-10-25: a `factory:lead` agent per area that splits the area
into worker-sized pieces and keeps its own `areas/<area-id>.md` record, with `commands/run.md`
dispatching leads instead of workers. Overlaying these two files restores that design in full.

Why it was folded: on the eval suite the lead tier never scored better. On the small cases
main never spawned a lead at all; on `large-five-areas` it spawned five leads and ten to
thirteen workers and tied on correctness with six workers dispatched directly, at a mean
$2.16 against $1.58 per run (n=2). See the factory README, "Measurements so far".

Re-run the comparison with:

    evals/compare.sh --case large-five-areas --runs 2 -j 2 plugins/factory/evals/variants/with-lead
