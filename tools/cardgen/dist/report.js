import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const LOCALES = ['en', 'pt-BR', 'fr'];
function pair(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const candidate = value;
    if (typeof candidate.t !== 'string' || typeof candidate.f !== 'string')
        return null;
    return { t: candidate.t, f: candidate.f };
}
export async function analyse(dir) {
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
    const byCategory = [];
    const byLocale = {};
    const problems = [];
    const seenRefs = new Set();
    let facts = 0;
    for (const file of files) {
        const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        const counts = { easy: 0, medium: 0, hard: 0 };
        for (const entry of parsed.facts) {
            facts += 1;
            counts[entry.difficulty] += 1;
            if (seenRefs.has(entry.ref))
                problems.push({ ref: entry.ref, issue: 'duplicate reference' });
            seenRefs.add(entry.ref);
            for (const locale of LOCALES) {
                const wording = pair(entry[locale]);
                if (!wording) {
                    problems.push({ ref: entry.ref, issue: `missing ${locale} wording` });
                    continue;
                }
                byLocale[locale] = (byLocale[locale] ?? 0) + 2;
                if (wording.t.trim() === wording.f.trim()) {
                    problems.push({ ref: entry.ref, issue: `${locale}: both wordings are identical` });
                }
                for (const [form, text] of [['true', wording.t], ['false', wording.f]]) {
                    if (text.trim().length < 10) {
                        problems.push({ ref: entry.ref, issue: `${locale} ${form} wording is too short` });
                    }
                    if (/\?\s*$/.test(text)) {
                        problems.push({ ref: entry.ref, issue: `${locale} ${form} wording is a question` });
                    }
                }
            }
        }
        byCategory.push({ slug: parsed.category.slug, ...counts, total: parsed.facts.length });
    }
    return {
        categories: files.length,
        facts,
        cards: facts * 2,
        byCategory,
        byLocale,
        problems,
    };
}
/**
 * The negation tell.
 *
 * If a negation word only ever appeared in false cards, a player could win by
 * scanning for it instead of knowing anything. This measures how far apart the
 * two halves are; the closer to zero, the less exploitable the card set is.
 */
export async function negationTell(dir) {
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    const NEGATION = /\b(not|never|no|cannot|n't|nunca|não|jamais|aucun|ne\s)\b/i;
    let trueWithNegation = 0;
    let falseWithNegation = 0;
    let facts = 0;
    for (const file of files) {
        const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        for (const entry of parsed.facts) {
            const wording = pair(entry.en);
            if (!wording)
                continue;
            facts += 1;
            if (NEGATION.test(wording.t))
                trueWithNegation += 1;
            if (NEGATION.test(wording.f))
                falseWithNegation += 1;
        }
    }
    const skew = facts === 0 ? 0 : ((falseWithNegation - trueWithNegation) / facts) * 100;
    return { trueWithNegation, falseWithNegation, facts, skewPercentagePoints: Number(skew.toFixed(2)) };
}
/** Picks a random sample for the manual accuracy review of step 9. */
export async function sample(dir, size) {
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    const rows = [];
    for (const file of files) {
        const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        for (const entry of parsed.facts) {
            for (const locale of LOCALES) {
                const wording = pair(entry[locale]);
                if (!wording)
                    continue;
                rows.push({ ref: entry.ref, locale, text: wording.t, label: 'TRUE' });
                rows.push({ ref: entry.ref, locale, text: wording.f, label: 'FALSE' });
            }
        }
    }
    for (let i = rows.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = rows[i];
        const b = rows[j];
        rows[i] = b;
        rows[j] = a;
    }
    return rows.slice(0, size);
}
