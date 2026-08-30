/**
 * The last stage — publish.
 *
 * Every loader in this directory lands its work as DRAFT, because a migration
 * that publishes as it goes gives you no moment to look at the result. This is
 * that moment's other side: once the review is done, it takes everything the
 * ledger recorded and makes it public, in one pass instead of 125 trips through
 * the CMS.
 *
 * Deliberately separate, deliberately not part of `load`, and it never picks
 * its own targets — it publishes exactly what is in out/ledger.json, so the set
 * it acts on is a file you can read first. `--dry` prints that set and writes
 * nothing.
 *
 * An article's status and its issue's status are independent by design (§21,
 * rule 18): publishing an issue does not publish its articles, and an article
 * attached to a draft issue is still invisible in the archive. Both halves are
 * needed, so both are done here.
 */
import * as api from "../lib/api.js";
import { load as openLedger } from "../lib/ledger.js";

/**
 * Puts an unpublished article back, by re-submitting the content it already
 * holds. The serialized version and the payload the API accepts are different
 * shapes — the byline is nested, blocks come back as `{type, data}` and go in
 * as `{blockType, content}` — so it is translated rather than passed through.
 */
async function republish(articleId) {
  const live = await api.getArticle(articleId);
  const version = live.currentVersion ?? live.pendingVersion;
  if (!version) throw new Error("no version to republish");

  await api.updatePublishedContent(articleId, {
    title: version.title,
    subtitle: version.subtitle ?? undefined,
    summary: version.summary ?? undefined,
    authorName: version.author?.name,
    authorBio: version.author?.bio ?? undefined,
    categoryId: version.categoryId,
    coverMediaId: version.coverMediaId ?? undefined,
    contentMode: version.contentMode,
    pdfMediaId: version.pdfMediaId ?? undefined,
    pdfPageCount: version.pdfPageCount ?? undefined,
    blocks: (version.blocks ?? []).map((block) => ({
      blockType: block.type,
      content: block.data,
    })),
  });
}

export default async function publishCommand({ only, dry }) {
  const ledger = openLedger();
  const issueKeys = Object.keys(ledger.state.issues)
    .filter((issueKey) => !only || issueKey.includes(only.toLowerCase()))
    .sort();

  if (!issueKeys.length) {
    console.error(
      `Nothing in the ledger${only ? ` matching "${only}"` : ""} — load something first.`,
    );
    process.exitCode = 1;
    return;
  }

  const planned = issueKeys.flatMap((issueKey) =>
    Object.values(ledger.issue(issueKey)?.articles ?? {}),
  );
  console.log(`  ${issueKeys.length} issue(s), ${planned.length} article(s) in the ledger`);

  if (dry) {
    for (const issueKey of issueKeys) {
      const articles = Object.values(ledger.issue(issueKey)?.articles ?? {});
      console.log(`  DRY publish ${issueKey} and its ${articles.length} article(s)`);
    }
    console.log("\n  --dry: nothing was published.");
    return;
  }

  const user = await api.login();
  console.log(`  authenticated as ${user.email} (${user.role})`);

  const problems = [];
  let articlesPublished = 0;
  let issuesPublished = 0;

  for (const issueKey of issueKeys) {
    const issue = ledger.issue(issueKey);

    for (const article of Object.values(issue.articles ?? {})) {
      try {
        await api.publishArticle(article.id);
        articlesPublished += 1;
      } catch (error) {
        // Already published is the expected outcome of a re-run, not a fault.
        if (/ALREADY_PUBLISHED|409/.test(error.message)) continue;

        // The ledger outlives the database. An entry whose row was deleted
        // elsewhere is stale bookkeeping, not a publish that failed — say so in
        // those terms, since the fix is to delete the entry, not to retry.
        if (/ 404 /.test(error.message)) {
          problems.push(
            `${issueKey} /${article.slug}: no such article — the ledger entry is stale, ` +
              "delete it from out/ledger.json (the loader will recreate the article)",
          );
          continue;
        }

        // An article that was published and then unpublished has no pending
        // version left to promote, so §31's edit-and-republish is the only way
        // back. Its own current content is re-submitted unchanged.
        if (/NO_PENDING_VERSION/.test(error.message)) {
          try {
            await republish(article.id);
            articlesPublished += 1;
          } catch (retry) {
            problems.push(`${issueKey} /${article.slug}: ${retry.message}`);
          }
          continue;
        }

        problems.push(`${issueKey} /${article.slug}: ${error.message}`);
      }
    }

    if (issue.id) {
      try {
        await api.publishIssue(issue.id);
        issuesPublished += 1;
      } catch (error) {
        if (!/NOT_DRAFT|409/.test(error.message)) {
          problems.push(`${issueKey} (issue): ${error.message}`);
        }
      }
    }

    console.log(`  ok ${issueKey}`);
  }

  console.log(`\n  published ${issuesPublished} issue(s) and ${articlesPublished} article(s)`);

  if (problems.length) {
    console.log(`\n  ${problems.length} item(s) failed:`);
    for (const problem of problems) console.log(`    - ${problem}`);
    process.exitCode = 1;
  }
}
