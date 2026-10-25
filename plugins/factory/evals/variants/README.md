# Variants

A variant is a directory of files that overlay `plugins/factory/` when `evals/compare.sh`
runs the suite, for example `variants/with-lead/commands/run.md`. The plugin in the repo is
never modified; each variant runs in its own copy. Put a `VARIANT.md` in the directory
saying what the variant changes and why; it is not copied.

Follow the article's rule: fold one thing per variant, run the same cases, keep the
folded version only if it does not score worse.
